require('dotenv').config();
const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet'); // Para escribir (Seguimiento)
const { google } = require('googleapis'); // Para leer (Base Grande)

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ============================================================================
// ⚠️ CONFIGURACIÓN DE LA MIGRACIÓN
// ============================================================================

// 1. ID DE LA HOJA NUEVA ("Produccion Dia Preventivo PR")
const NUEVA_BASE_ID = '1N9grVSOQgG_-XSJBZVs02V5kSEeq23bA7pY7yBfXLPw'; 

// 2. ID DE LA HOJA DE ESCRITURA (No cambia)
const SEGUIMIENTO_SHEET_ID = '1Yoxu-UgFcU09AWznbQEx9pZGcUQo9gINiVHOhuwfFZ8';

// 3. DICCIONARIO MAESTRO DE TRADUCCIÓN (Vital para que no se rompa nada)
// Izquierda: Nombre que usa el SISTEMA (Viejo) || Derecha: Nombre en la HOJA NUEVA
const MAPEO_CAMPOS = {
    // Datos Personales
    'DNI': 'DNI',
    'Fecha_cierre_DP': 'FECHAX', // La fecha clave
    'Edad': 'Edad',
    'Sexo': 'Sexo',
    
    // El sistema espera Nombre y Apellido separados, pero la hoja nueva los tiene juntos.
    // Mapeamos ambos a la misma columna y luego el código los arregla.
    'Nombre': 'apellido y nombre',
    'Apellido': 'apellido y nombre', 

    // Campos Clínicos (Cuidado con tildes y espacios)
    'Presion_Arterial': 'Presión Arterial',
    'IMC': 'IMC',
    'Agudeza_visual': 'Agudeza visual',
    'Control_odontologico': 'Control Odontológico - Adultos',
    'Valor_CPO': 'Valor CPO',
    'Alimentacion_saludable': 'Alimentación saludable',
    'Actividad_fisica': 'Actividad física',
    'Seguridad_vial': 'Seguridad vial',
    'Caidas_en_adultos_mayores': 'Caídas en adultos mayores',
    'Acido_folico': 'Ácido fólico',
    'Abuso_alcohol': 'Abuso alcohol',
    'Tabaco': 'Tabaco',
    'Violencia': 'Violencia',
    'Depresion': 'Depresión',
    'ITS': 'ITS',
    'Hepatitis_B': 'Hepatitis B',
    'Hepatitis_C': 'Hepatitis C',
    'VIH': 'VIH',
    'Dislipemias': 'Dislipemias',
    'Diabetes': 'Diabetes',
    
    // Cánceres y Estudios
    'Cancer_cervico_uterino_HPV': 'Cáncer cérvico uterino - HPV',
    'Cancer_cervico_uterino_PAP': 'Cáncer cérvico uterino - PAP',
    'Cancer_colon_SOMF': 'SOMF', // Ojo aquí, cambio de nombre importante
    'Cancer_colon_Colonoscopia': 'Cáncer colon - Colonoscopía',
    'Cancer_mama_Mamografia': 'Cáncer mama - Mamografía',
    'Cancer_mama_Eco_mamaria': 'Cancer_mama_Eco_mamaria',
    
    // Otros
    'ERC': 'ERC',
    'EPOC': 'EPOC',
    'Aneurisma_aorta': 'Aneurisma aorta',
    'Osteoporosis': 'Osteoporosis',
    'Estratificacion_riesgo_CV': 'Estratificación riesgo CV',
    'Aspirina': 'Aspirina',
    'Inmunizaciones': 'Inmunizaciones',
    'Profesional': 'Profesional',
    'VDRL': 'VDRL',
    'Prostata_PSA': 'Próstata - PSA',
    'Chagas': 'Chagas'
};

// ============================================================================

let docSeguimiento; 
let sheetsApiClient; 
let credentials;

app.use(express.json());
app.use(express.static('public'));

// --- INICIALIZACIÓN ---
async function initializeGoogleSheets() {
    try {
        if (process.env.CREDENTIALS_JSON) {
            credentials = JSON.parse(process.env.CREDENTIALS_JSON);
        } else {
            credentials = require('./credentials.json');
        }
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        // 1. Cliente API Nativa (Lectura Ultraligera)
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: credentials.client_email,
                private_key: privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheetsApiClient = google.sheets({ version: 'v4', auth });
        
        try {
            const meta = await sheetsApiClient.spreadsheets.get({ spreadsheetId: NUEVA_BASE_ID });
            console.log(`✅ Conectado a Base Grande (Lectura): "${meta.data.properties.title}"`);
        } catch (e) {
            console.error(`❌ ERROR CRÍTICO: No se puede leer la Base Grande.`);
            console.error('👉 Solución: Verifica el ID y comparte la hoja con el email del robot.');
        }

        // 2. Cliente Escritura (Seguimiento)
        docSeguimiento = new GoogleSpreadsheet(SEGUIMIENTO_SHEET_ID);
        await docSeguimiento.useServiceAccountAuth({
            client_email: credentials.client_email,
            private_key: privateKey,
        });
        await docSeguimiento.loadInfo();
        console.log('✅ Hoja SEGUIMIENTO cargada (Escritura).');
        await configurarColumnasHoja();

    } catch (error) {
        console.error('❌ Error fatal arranque:', error.message);
    }
}

// --- BUSCADOR INTELIGENTE CON TRADUCCIÓN ---
async function buscarPacienteEnHoja(dniBuscado) {
    try {
        // 1. Obtener datos crudos (Texto plano)
        const metaData = await sheetsApiClient.spreadsheets.get({ spreadsheetId: NUEVA_BASE_ID });
        const title = metaData.data.sheets[0].properties.title; // Usamos la primera pestaña

        const response = await sheetsApiClient.spreadsheets.values.get({
            spreadsheetId: NUEVA_BASE_ID,
            range: `${title}!A:ZZ`, 
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return null;

        const headers = rows[0]; // Encabezados reales de la hoja nueva
        
        // 2. Encontrar la columna DNI real
        // Buscamos la columna mapeada como 'DNI' en nuestro diccionario
        const nombreColumnaDNI = MAPEO_CAMPOS['DNI']; 
        const idxDNI = headers.findIndex(h => h && h.toLowerCase().trim() === nombreColumnaDNI.toLowerCase().trim());
        
        if (idxDNI === -1) {
            console.error(`❌ ERROR: No encuentro la columna "${nombreColumnaDNI}" en la hoja nueva.`);
            return null;
        }

        const dniString = String(dniBuscado).trim();

        // 3. Filtrar filas (Búsqueda rápida)
        // Normalizamos quitando puntos para comparar (ej: 30.123.456 vs 30123456)
        const encontrados = rows.slice(1).filter(row => {
            const valEnBase = row[idxDNI] ? String(row[idxDNI]).replace(/\./g, '').trim() : '';
            const valBuscado = dniString.replace(/\./g, '').trim();
            return valEnBase === valBuscado;
        });

        if (encontrados.length === 0) return null;

        // 4. TRADUCCIÓN DE RESULTADOS (La magia)
        const resultadosTraducidos = encontrados.map(row => {
            const pacienteObj = {};

            // Recorremos nuestro diccionario de campos que la App necesita
            Object.keys(MAPEO_CAMPOS).forEach(keyApp => {
                const nombreColumnaExcel = MAPEO_CAMPOS[keyApp];
                
                // Buscamos dónde está esa columna en el Excel
                const idx = headers.findIndex(h => h && h.toLowerCase().trim() === nombreColumnaExcel.toLowerCase().trim());
                
                if (idx !== -1) {
                    pacienteObj[keyApp] = row[idx] || ''; // Asignamos el valor
                } else {
                    pacienteObj[keyApp] = ''; // Si no existe la columna, devolvemos vacío
                }
            });

            // FIX ESPECIAL: Separar Nombre y Apellido si vienen juntos
            if (pacienteObj['Nombre'] && pacienteObj['Nombre'] === pacienteObj['Apellido']) {
                // Si ambos apuntan a 'apellido y nombre', el valor será ej: "PEREZ JUAN"
                // Dejamos el nombre completo en 'Nombre' y vaciamos 'Apellido' para que el frontend
                // muestre "PEREZ JUAN " (unido) en lugar de "PEREZ JUAN PEREZ JUAN"
                pacienteObj['Apellido'] = ''; 
            }

            return pacienteObj;
        });

        return resultadosTraducidos;

    } catch (error) {
        console.error('Error lectura Base Grande:', error);
        throw error;
    }
}

// --- CONFIGURACIÓN COLUMNAS ESCRITURA ---
async function configurarColumnasHoja() {
    if (!docSeguimiento) return;
    try {
        const headers = ['Fecha_Seguimiento', 'DNI_Paciente', 'Nombre_Paciente', 'Profesional_Apellido_Nombre', 'Profesional_Matricula'];
        const TEMAS = [
            "Diabetes", "Dislipemia", "Tabaquismo", "Actividad_Fisica", "Hipertension", "IMC", "Agudeza_visual", "Control_Odontologico", 
            "Alimentacion_Saludable", "Prevencion_de_Caidas", "Acido_Folico", "Seguridad_Vial", "Consumo_de_Alcohol", "Violencia", "Depresion", 
            "Infecciones_de_Transmision_Sexual", "Hepatitis_B", "Hepatitis_C", "VIH", "Test_de_HPV", "Papanicolaou", "SOMF", "Colonoscopia", 
            "Mamografia", "PSA", "ERC", "EPOC", "Aneurisma_aorta", "Osteoporosis", "Aspirina", "Riesgo_Cardiovascular",
            "Gestion_Emocional", "Adherencia_Tratamiento", "Redes_Apoyo", "Actividad_Descanso"
        ];
        TEMAS.forEach(tema => { headers.push(`${tema}_Calificacion`); headers.push(`${tema}_Observaciones`); });
        headers.push('Observacion_Profesional');

        let sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) { sheet = await docSeguimiento.addSheet({ title: 'Seguimiento', headerValues: headers }); }
        else { await sheet.loadHeaderRow(); if (!sheet.headerValues || sheet.headerValues.length === 0) await sheet.setHeaderRow(headers); }
    } catch (e) { console.error('Warn columnas:', e.message); }
}
// --- RUTA BUSCAR ---
app.post('/buscar', async (req, res) => {
    try {
        const dni = String(req.body.dni).trim();
        console.log(`🔎 Buscando DNI: ${dni}`);

        const resultados = await buscarPacienteEnHoja(dni);
        
        if (!resultados || resultados.length === 0) {
            return res.json({ error: 'DNI no encontrado en el padrón.' });
        }

        // Ordenar por fecha
        const parseDate = (d) => {
             if(!d) return new Date(NaN);
             // Intenta detectar formato con barra / o guion -
             const p = d.includes('/') ? d.split('/') : d.split('-'); 
             // Asumimos DD/MM/YYYY o YYYY-MM-DD según longitud
             if (p[0].length === 4) return new Date(p[0], p[1]-1, p[2]); // YYYY-MM-DD
             return p.length===3 ? new Date(p[2], p[1]-1, p[0]) : new Date(NaN); // DD/MM/YYYY
        };
        
        try {
            resultados.sort((a, b) => parseDate(b['Fecha_cierre_DP']).getTime() - parseDate(a['Fecha_cierre_DP']).getTime());
        } catch (e) {}

        res.json({ 
            pacientePrincipal: resultados[0], 
            estudiosPrevios: resultados.slice(1).map(e => ({ fecha: e['Fecha_cierre_DP'] })) 
        });

    } catch (e) { 
        console.error('Error búsqueda:', e);
        res.status(500).json({ error: 'Error interno de búsqueda.' }); 
    }
});

// --- RESTO DE RUTAS ---
app.post('/api/seguimiento/guardar', async (req, res) => {
    try {
        const data = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false, error: 'DB Seguimiento desconectada' });
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        
        const mapeo = {
            "Diabetes": "Diabetes", "Dislipemia": "Dislipemia", "Tabaquismo": "Tabaquismo", "Actividad Fisica": "Actividad_Fisica", 
            "Hipertension": "Hipertension", "IMC": "IMC", "Agudeza Visual": "Agudeza_visual", "Control Odontologico": "Control_Odontologico",
            "Alimentacion Saludable": "Alimentacion_Saludable", "Prevencion de Caidas": "Prevencion_de_Caidas", "Acido Folico": "Acido_Folico", 
            "Seguridad Vial": "Seguridad_Vial", "Consumo de Alcohol": "Consumo_de_Alcohol", "Violencia": "Violencia", "Depresion": "Depresion", 
            "Infecciones de Transmision Sexual": "Infecciones_de_Transmision_Sexual", "Hepatitis B": "Hepatitis_B", "Hepatitis C": "Hepatitis_C", 
            "VIH": "VIH", "Test de HPV": "Test_de_HPV", "Papanicolaou": "Papanicolaou", "SOMF": "SOMF", "Colonoscopia": "Colonoscopia", 
            "Mamografia": "Mamografia", "PSA": "PSA", "ERC": "ERC", "EPOC": "EPOC", "Aneurisma aorta": "Aneurisma_aorta", 
            "Osteoporosis": "Osteoporosis", "Aspirina": "Aspirina", "Riesgo Cardiovascular": "Riesgo_Cardiovascular",
            "Gestión Emocional": "Gestion_Emocional", "Adherencia al Tratamiento": "Adherencia_Tratamiento", 
            "Redes de Apoyo": "Redes_Apoyo", "Actividad y Descanso": "Actividad_Descanso"
        };

        const row = {
            'Fecha_Seguimiento': data.fecha, 'DNI_Paciente': data.paciente.dni, 'Nombre_Paciente': data.paciente.nombre,
            'Profesional_Apellido_Nombre': data.profesional.nombre, 'Profesional_Matricula': data.profesional.matricula,
            'Observacion_Profesional': data.observacionProfesional
        };

        if (data.evaluaciones) {
            data.evaluaciones.forEach(ev => {
                let key = ev.motivo.split('(')[0].trim();
                let col = mapeo[ev.motivo] || mapeo[key];
                if (!col) {
                     const norm = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                     const match = Object.keys(mapeo).find(k => k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === norm);
                     if (match) col = mapeo[match];
                }
                if (col) { row[`${col}_Calificacion`] = ev.calificacion; row[`${col}_Observaciones`] = ev.observaciones; }
            });
        }
        await sheet.addRow(row);
        // Guardar en Supabase
try {
    const supabaseRow = {
        fecha_seguimiento: data.fecha,
        dni_paciente: data.paciente.dni,
        nombre_paciente: data.paciente.nombre,
        profesional_apellido_nombre: data.profesional.nombre,
        profesional_matricula: data.profesional.matricula,
        observacion_profesional: data.observacionProfesional
    };

    if (data.evaluaciones) {
        const mapeoSupabase = {
            "Diabetes": "diabetes", "Dislipemia": "dislipemia", "Tabaquismo": "tabaquismo",
            "Actividad Fisica": "actividad_fisica", "Hipertension": "hipertension", "IMC": "imc",
            "Agudeza Visual": "agudeza_visual", "Control Odontologico": "control_odontologico",
            "Alimentacion Saludable": "alimentacion_saludable", "Prevencion de Caidas": "prevencion_caidas",
            "Acido Folico": "acido_folico", "Seguridad Vial": "seguridad_vial",
            "Consumo de Alcohol": "consumo_alcohol", "Violencia": "violencia", "Depresion": "depresion",
            "Infecciones de Transmision Sexual": "its", "Hepatitis B": "hepatitis_b",
            "Hepatitis C": "hepatitis_c", "VIH": "vih", "Test de HPV": "hpv",
            "Papanicolaou": "papanicolau", "SOMF": "somf", "Colonoscopia": "colonoscopia",
            "Mamografia": "mamografia", "PSA": "psa", "ERC": "erc", "EPOC": "epoc",
            "Aneurisma aorta": "aneurisma_aorta", "Osteoporosis": "osteoporosis",
            "Aspirina": "aspirina", "Gestión Emocional": "gestion_emocional",
            "Adherencia al Tratamiento": "adherencia_tratamiento", "Redes de Apoyo": "redes_apoyo",
            "Actividad y Descanso": "actividad_descanso"
        };

        data.evaluaciones.forEach(ev => {
            const key = ev.motivo.split('(')[0].trim();
            const col = mapeoSupabase[ev.motivo] || mapeoSupabase[key];
            if (col) {
                supabaseRow[`${col}_calificacion`] = ev.calificacion;
                supabaseRow[`${col}_observaciones`] = ev.observaciones;
            }
        });
    }

    const { error: supaError } = await supabase
        .from('seguimiento_cronicos')
        .insert(supabaseRow);

    if (supaError) console.error('Error Supabase seguimiento:', supaError);
    else console.log('✅ Seguimiento guardado en Supabase para DNI:', data.paciente.dni);
} catch (e) {
    console.error('Error Supabase seguimiento catch:', e.message);
}
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/seguimiento/historial', async (req, res) => {
    try {
        const { dni } = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false });
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) return res.json({ success: true, historial: [] });
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();
        const historial = rows.filter(r => String(r['DNI_Paciente']).trim() === String(dni).trim()).map(r => { const d = {}; sheet.headerValues.forEach(h => d[h] = r[h]); return d; });
        historial.sort((a, b) => new Date(b.Fecha_Seguimiento) - new Date(a.Fecha_Seguimiento));
        res.json({ success: true, historial });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/verificar-seguimiento', async (req, res) => {
    const dni = String(req.body.dni).trim();
    const hoy = new Date();

    try {
        // 1. Verificar en IAPOS
        const fechaHoy = hoy.toISOString().split('T')[0];
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
                <BEWsValidaAfi.Execute xmlns="IAPOS_WS">
                    <Usuario>CONSULTAPDP</Usuario>
                    <Passwd>1Qaz</Passwd>
                    <Nafiliado>${dni}</Nafiliado>
                    <Badocnumdo>${dni}</Badocnumdo>
                    <Tidocodigo_de_documento>96</Tidocodigo_de_documento>
                    <Ogorcodigo>1</Ogorcodigo>
                    <Fechpresta>${fechaHoy}</Fechpresta>
                </BEWsValidaAfi.Execute>
            </soap:Body>
        </soap:Envelope>`;

        let datosIAPOS = null;
        try {
            const iaposRes = await axios.post(
                'https://aswe.santafe.gov.ar/iapos-sw-srvt/servlet/abewsvalidaafi',
                soapBody,
                { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'IAPOS_WSaction/ABEWSVALIDAAFI.Execute' }, timeout: 10000 }
            );
            const xml = iaposRes.data;
            const getValor = (tag) => {
                const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`));
                return match ? match[1].trim() : null;
            };
            datosIAPOS = {
                esActivo: getValor('Estado') === 'A',
                nombre: getValor('Apenom'),
                edad: getValor('Edad'),
                sexo: getValor('Sexo'),
                localidad: getValor('Localidad')
            };
        } catch (e) {
            console.error('Error IAPOS:', e.message);
        }

        // 2. Buscar historial DP en Supabase
        const { data: historialDP } = await supabase
            .from('historial_dia_preventivo')
            .select('*')
            .eq('dni', dni)
            .in('tipo', ['Adultos', 'Pediatria'])
            .order('fechax', { ascending: false });

        const ultimoDP = historialDP?.[0] || null;

        // 3. Verificar bloqueos
        let bloqueado = false;
        let motivoBloqueo = null;
// En lugar de bloquear, solo informamos
        if (!ultimoDP) {
            bloqueado = false; // no bloqueamos
            motivoBloqueo = 'NO_DP'; // solo avisamos
        } else {
            const unAnioAtras = new Date(ultimoDP.fechax);
            unAnioAtras.setFullYear(unAnioAtras.getFullYear() + 1);
            if (hoy > unAnioAtras) {
            bloqueado = false; // no bloqueamos
            motivoBloqueo = 'DP_VENCIDO'; // solo avisamos
            }
        }

        // 4. Contar seguimientos desde el último DP
        let cantSeguimientos = 0;
        if (ultimoDP) {
            const { data: seguimientos } = await supabase
                .from('seguimiento_cronicos')
                .select('id')
                .eq('dni_paciente', dni)
                .gte('created_at', ultimoDP.fechax);
            cantSeguimientos = seguimientos?.length || 0;

            if (!bloqueado && cantSeguimientos >= 4) {
                bloqueado = true;
                motivoBloqueo = 'LIMITE_SEGUIMIENTOS';
            }
        }

        // 5. Estudios complementarios
        const { data: estudios } = await supabase
            .from('practicas_autorizadas')
            .select('*')
            .eq('dni', dni)
            .eq('estado', 'REALIZADA');

        // 6. Alertas clínicas
        const alertas = [];
        if (ultimoDP) {
            if (ultimoDP.cancer_cervico_hpv === 'Patologico') alertas.push({ tipo: 'URGENTE', mensaje: '🔴 HPV Patológico — verificar PAP' });
            if (ultimoDP.somf === 'Patologico') alertas.push({ tipo: 'URGENTE', mensaje: '🔴 SOMF Patológico — indicar VCC urgente' });
            if (ultimoDP.diabetes === 'Presenta') alertas.push({ tipo: 'RIESGO', mensaje: '⚠️ Diabetes — verificar HbA1c y fondo de ojo' });
            if (ultimoDP.dislipemias === 'Presenta') alertas.push({ tipo: 'RIESGO', mensaje: '⚠️ Dislipemia — verificar tratamiento' });
            if (ultimoDP.presion_arterial === 'Hipertensión') alertas.push({ tipo: 'RIESGO', mensaje: '⚠️ Hipertensión — verificar tratamiento' });
            if (ultimoDP.osteoporosis === 'Se verifica') alertas.push({ tipo: 'RIESGO', mensaje: '⚠️ Osteoporosis — verificar tratamiento' });
            if (ultimoDP.epoc === 'Se verifica') alertas.push({ tipo: 'RIESGO', mensaje: '⚠️ EPOC — verificar espirometría' });
        }

        res.json({
            success: true,
            bloqueado,
            motivoBloqueo,
            iapos: datosIAPOS,
            ultimoDP,
            historialDP: historialDP || [],
            cantSeguimientos,
            estudios: estudios || [],
            alertas
        });

    } catch (e) {
        console.error('Error verificar seguimiento:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});
async function iniciarApp() {
    const maxIntentos = 5;
    let retraso = 1000;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            console.log(`⏳ Cargando Google Sheet (Intento ${intento}/${maxIntentos})...`);
            await initializeGoogleSheets();
            console.log('✅ Google Sheets conectado.');
            break;
        } catch (error) {
            console.error(`⚠️ Intento ${intento} fallido:`, error.message);
            if (intento === maxIntentos) {
                console.error('⚠️ Google Sheets no disponible al arrancar — el servidor sigue funcionando sin Sheets.');
            } else {
                console.log(`🔄 Reintentando en ${retraso / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, retraso));
                retraso *= 2;
            }
        }
    }
    app.listen(PORT, () => console.log(`✅ Servidor migrado listo en ${API_BASE_URL}`));
}

iniciarApp();