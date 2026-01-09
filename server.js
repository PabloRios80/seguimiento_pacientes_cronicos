require('dotenv').config();
const express = require('express');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet'); // Para escribir (Seguimiento)
const { google } = require('googleapis'); // Para leer rápido (Pacientes)
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- CONSTANTES ---
const PACIENTES_SHEET_ID = '15YPfBG9PBfN3nBW5xXJYjIXEgYIS9z71pI0VpeCtAAU'; // Hoja Pesada (Lectura)
const SEGUIMIENTO_SHEET_ID = '1Yoxu-UgFcU09AWznbQEx9pZGcUQo9gINiVHOhuwfFZ8'; // Hoja Nueva (Escritura)

// --- VARIABLES GLOBALES ---
let docSeguimiento; // Usaremos GoogleSpreadsheet solo para escribir (es más fácil)
let sheetsApiClient; // Usaremos la API nativa para leer pacientes (es más ligera)
let credentials;

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'tu-secreto-seguro',
    resave: false,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

// --- INICIALIZACIÓN ---
async function initializeGoogleSheets() {
    try {
        if (process.env.CREDENTIALS_JSON) {
            credentials = JSON.parse(process.env.CREDENTIALS_JSON);
        } else {
            credentials = require('./credentials.json');
        }
        
        // Formatear clave privada correctamente
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        // 1. CONFIGURAR CLIENTE DE API NATIVA (Para Lectura Ultraligera)
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: credentials.client_email,
                private_key: privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheetsApiClient = google.sheets({ version: 'v4', auth });
        console.log('✅ Cliente API Nativa listo (Lectura optimizada).');

        // 2. CONFIGURAR CLIENTE DE ESCRITURA (Para Seguimiento)
        docSeguimiento = new GoogleSpreadsheet(SEGUIMIENTO_SHEET_ID);
        await docSeguimiento.useServiceAccountAuth({
            client_email: credentials.client_email,
            private_key: privateKey,
        });
        await docSeguimiento.loadInfo();
        console.log('✅ Hoja SEGUIMIENTO cargada (Escritura).');

        // Configurar columnas si es necesario
        await configurarColumnasHoja();

    } catch (error) {
        console.error('❌ Error fatal inicializando conexiones:', error);
        // No matamos el proceso, dejamos que intente recuperarse o muestre error 500 limpio
    }
}

// --- FUNCIÓN DE LECTURA OPTIMIZADA (MEMORIA BAJA) ---
// Esta función descarga los datos como una matriz de texto simple [[]], sin objetos pesados.
async function buscarPacienteEnHoja(dniBuscado) {
    try {
        // 1. Obtener información básica para saber el nombre de la Hoja 1
        const metaData = await sheetsApiClient.spreadsheets.get({
            spreadsheetId: PACIENTES_SHEET_ID
        });
        // Asumimos que los pacientes están en la primera pestaña (índice 0)
        const title = metaData.data.sheets[0].properties.title;

        // 2. Descargar SOLO los valores (texto plano)
        const response = await sheetsApiClient.spreadsheets.values.get({
            spreadsheetId: PACIENTES_SHEET_ID,
            range: `${title}!A:ZZ`, // Leemos todas las columnas
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return null;

        // 3. Procesar encabezados (Fila 0)
        const headers = rows[0];
        
        // 4. Buscar DNI en memoria (Es texto plano, muy rápido)
        // Buscamos índice de columna DNI o Documento
        const dniIndex = headers.findIndex(h => h && (h.toLowerCase() === 'dni' || h.toLowerCase() === 'documento'));
        
        if (dniIndex === -1) {
            console.error('Columna DNI no encontrada en la hoja de pacientes');
            return null;
        }

        const dniString = String(dniBuscado).trim();

        // Filtramos las filas que coincidan
        // rows.slice(1) evita el encabezado
        const encontrados = rows.slice(1).filter(row => {
            const val = row[dniIndex] ? String(row[dniIndex]).trim() : '';
            return val === dniString;
        });

        if (encontrados.length === 0) return null;

        // 5. Convertir el array encontrado a Objeto bonito para el frontend
        // Mapeamos [ 'Juan', '123' ] -> { Nombre: 'Juan', DNI: '123' }
        const resultadosMapeados = encontrados.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                if (header) obj[header] = row[index] || '';
            });
            return obj;
        });

        return resultadosMapeados;

    } catch (error) {
        console.error('Error en lectura ligera:', error);
        throw error;
    }
}

// --- CONFIGURACIÓN DE COLUMNAS (SEGUIMIENTO) ---
async function configurarColumnasHoja() {
    if (!docSeguimiento) return;
    try {
        const headers = ['Fecha_Seguimiento', 'DNI_Paciente', 'Nombre_Paciente', 'Profesional_Apellido_Nombre', 'Profesional_Matricula'];
        
        // Lista Maestra
        const TEMAS = [
            "Diabetes", "Dislipemia", "Tabaquismo", "Actividad_Fisica", 
            "Hipertension", "IMC", "Agudeza_visual", "Control_Odontologico", 
            "Alimentacion_Saludable", "Prevencion_de_Caidas", "Acido_Folico", 
            "Seguridad_Vial", "Consumo_de_Alcohol", "Violencia", "Depresion", 
            "Infecciones_de_Transmision_Sexual", "Hepatitis_B", "Hepatitis_C", 
            "VIH", "Test_de_HPV", "Papanicolaou", "SOMF", "Colonoscopia", 
            "Mamografia", "PSA", "ERC", "EPOC", "Aneurisma_aorta", 
            "Osteoporosis", "Aspirina", "Riesgo_Cardiovascular",
            "Gestion_Emocional", "Adherencia_Tratamiento", "Redes_Apoyo", "Actividad_Descanso"
        ];

        TEMAS.forEach(tema => {
            headers.push(`${tema}_Calificacion`);
            headers.push(`${tema}_Observaciones`);
        });
        headers.push('Observacion_Profesional');

        let sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) {
            sheet = await docSeguimiento.addSheet({ title: 'Seguimiento', headerValues: headers });
        } else {
            await sheet.loadHeaderRow();
            if (!sheet.headerValues || sheet.headerValues.length === 0) await sheet.setHeaderRow(headers);
        }
    } catch (e) { console.error('Warn config columnas:', e.message); }
}

// --- AUTH GOOGLE ---
app.get('/auth/google', (req, res, next) => { req.session.returnTo = req.query.returnTo || '/'; next(); }, passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html' }), (req, res) => { const url = req.session.returnTo || '/'; delete req.session.returnTo; res.redirect(url); });
passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.GOOGLE_CALLBACK_URL }, (a, r, p, d) => d(null, p)));
passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
app.get('/api/user', (req, res) => req.isAuthenticated() ? res.json({ isLoggedIn: true, user: { name: req.user.displayName, email: req.user.emails[0].value } }) : res.json({ isLoggedIn: false }));

// --- RUTA BUSCAR (OPTIMIZADA) ---
app.post('/buscar', async (req, res) => {
    try {
        const dni = String(req.body.dni).trim();
        console.log(`🔎 Buscando DNI (Modo Ligero): ${dni}`);

        // Usamos la nueva función ligera
        const resultados = await buscarPacienteEnHoja(dni);
        
        if (!resultados || resultados.length === 0) {
            return res.json({ error: 'DNI no encontrado en el padrón.' });
        }

        // Ordenar por fecha (Fecha_cierre_DP)
        const parseDate = (d) => {
             if(!d) return new Date(NaN);
             const p = d.split('/');
             return p.length===3 ? new Date(p[2], p[1]-1, p[0]) : new Date(NaN);
        };
        resultados.sort((a, b) => parseDate(b['Fecha_cierre_DP']).getTime() - parseDate(a['Fecha_cierre_DP']).getTime());

        // Retornamos el más reciente como principal y el resto como historial
        res.json({ 
            pacientePrincipal: resultados[0], 
            estudiosPrevios: resultados.slice(1).map(e => ({ fecha: e['Fecha_cierre_DP'] })) 
        });

    } catch (e) { 
        console.error('Error en búsqueda:', e);
        res.status(500).json({ error: 'Error interno al procesar la búsqueda.' }); 
    }
});

// --- RUTA GUARDAR SEGUIMIENTO ---
app.post('/api/seguimiento/guardar', async (req, res) => {
    try {
        const data = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false, error: 'DB Seguimiento no conectada' });
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        
        const mapeoColumnas = {
            "Diabetes": "Diabetes", "Dislipemia": "Dislipemia", "Tabaquismo": "Tabaquismo",
            "Actividad Fisica": "Actividad_Fisica", "Actividad Física": "Actividad_Fisica",
            "Hipertension": "Hipertension", "Hipertensión": "Hipertension", "IMC": "IMC",
            "Agudeza Visual": "Agudeza_visual", "Control Odontologico": "Control_Odontologico",
            "Alimentacion Saludable": "Alimentacion_Saludable", "Alimentación Saludable": "Alimentacion_Saludable",
            "Prevencion de Caidas": "Prevencion_de_Caidas", "Prevención de Caídas": "Prevencion_de_Caidas",
            "Acido Folico": "Acido_Folico", "Seguridad Vial": "Seguridad_Vial", 
            "Consumo de Alcohol": "Consumo_de_Alcohol", "Violencia": "Violencia", "Depresion": "Depresion", 
            "Infecciones de Transmision Sexual": "Infecciones_de_Transmision_Sexual", "Hepatitis B": "Hepatitis_B", 
            "Hepatitis C": "Hepatitis_C", "VIH": "VIH", "Test de HPV": "Test_de_HPV", 
            "Papanicolaou": "Papanicolaou", "SOMF": "SOMF", "Colonoscopia": "Colonoscopia", 
            "Mamografia": "Mamografia", "PSA": "PSA", "ERC": "ERC", "EPOC": "EPOC", 
            "Aneurisma aorta": "Aneurisma_aorta", "Osteoporosis": "Osteoporosis", "Aspirina": "Aspirina", 
            "Riesgo Cardiovascular": "Riesgo_Cardiovascular",
            "Gestión Emocional": "Gestion_Emocional", "Adherencia al Tratamiento": "Adherencia_Tratamiento",
            "Redes de Apoyo": "Redes_Apoyo", "Actividad y Descanso": "Actividad_Descanso"
        };

        const row = {
            'Fecha_Seguimiento': data.fecha, 'DNI_Paciente': data.paciente.dni,
            'Nombre_Paciente': data.paciente.nombre, 'Profesional_Apellido_Nombre': data.profesional.nombre,
            'Profesional_Matricula': data.profesional.matricula, 'Observacion_Profesional': data.observacionProfesional
        };

        if (data.evaluaciones) {
            data.evaluaciones.forEach(ev => {
                let key = ev.motivo.split('(')[0].trim();
                let col = mapeoColumnas[ev.motivo] || mapeoColumnas[key];
                if (!col) {
                     const norm = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                     const match = Object.keys(mapeoColumnas).find(k => k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === norm);
                     if (match) col = mapeoColumnas[match];
                }
                if (col) { row[`${col}_Calificacion`] = ev.calificacion; row[`${col}_Observaciones`] = ev.observaciones; }
            });
        }
        await sheet.addRow(row);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- RUTA HISTORIAL ---
app.post('/api/seguimiento/historial', async (req, res) => {
    try {
        const { dni } = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false });
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) return res.json({ success: true, historial: [] });

        await sheet.loadHeaderRow();
        const rows = await sheet.getRows(); // Aquí sí usamos getRows porque la hoja de seguimiento es ligera aún
        const historial = rows
            .filter(r => String(r['DNI_Paciente']).trim() === String(dni).trim())
            .map(r => {
                const d = {}; sheet.headerValues.forEach(h => d[h] = r[h]); return d;
            });
        
        historial.sort((a, b) => new Date(b.Fecha_Seguimiento) - new Date(a.Fecha_Seguimiento));
        res.json({ success: true, historial });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- INICIO ---
initializeGoogleSheets().then(() => {
    app.listen(PORT, () => console.log(`✅ Servidor optimizado listo en ${API_BASE_URL}`));
});