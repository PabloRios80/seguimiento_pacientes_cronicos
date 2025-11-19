require('dotenv').config();
const express = require('express');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { google } = require('googleapis');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const streamifier = require('streamifier');
const v8 = require('v8');

// --- CONFIGURACIÓN DE MEMORIA Y GC (De tu código original) ---
v8.setFlagsFromString('--max-old-space-size=8192'); // 8GB
const heapSizeLimit = 8192 * 1024 * 1024;
if (process.memoryUsage().heapTotal > heapSizeLimit) {
    console.warn('⚠️ Memoria cerca del límite, forzando garbage collection');
    if (global.gc) global.gc();
}
setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Garbage collection ejecutado');
    }
}, 30000);

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- CONSTANTES DE HOJAS DE CÁLCULO ---
const PACIENTES_SHEET_ID = '15YPfBG9PBfN3nBW5xXJYjIXEgYIS9z71pI0VpeCtAAU'; // Tu hoja original de lectura
const SEGUIMIENTO_SHEET_ID = '1Yoxu-UgFcU09AWznbQEx9pZGcUQo9gINiVHOhuwfFZ8'; // La NUEVA hoja de escritura

// --- VARIABLES GLOBALES ---
let doc; // Documento de Pacientes (Lectura y otras escrituras viejas)
let docSeguimiento; // Documento nuevo para Seguimiento Crónicos
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

// --- INICIALIZACIÓN GOOGLE SHEETS (FUSIONADA) ---
async function initializeGoogleSheets() {
    try {
        // 1. Cargar Credenciales
        if (process.env.CREDENTIALS_JSON) {
            credentials = JSON.parse(process.env.CREDENTIALS_JSON);
        } else {
            credentials = require('./credentials.json');
        }
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        // 2. Inicializar Doc Pacientes (Original)
        doc = new GoogleSpreadsheet(PACIENTES_SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: credentials.client_email,
            private_key: privateKey,
        });
        await doc.loadInfo();
        console.log('✅ Hoja PACIENTES (Original) cargada:', doc.title);

        // 3. Inicializar Doc Seguimiento (Nuevo)
        docSeguimiento = new GoogleSpreadsheet(SEGUIMIENTO_SHEET_ID);
        await docSeguimiento.useServiceAccountAuth({
            client_email: credentials.client_email,
            private_key: privateKey,
        });
        
        try {
            await docSeguimiento.loadInfo();
            console.log('✅ Hoja SEGUIMIENTO (Nueva) cargada:', docSeguimiento.title);
        } catch (e) {
            console.error('⚠️ ALERTA: No se pudo acceder a la hoja SEGUIMIENTO. ¿Añadiste el email:', credentials.client_email, 'como Editor?');
        }

    } catch (error) {
        console.error('❌ Error fatal inicializando Google Sheets:', error);
        process.exit(1);
    }
}

// --- AUTH ROUTES (De tu código original) ---
app.get('/auth/google', (req, res, next) => {
    req.session.returnTo = req.query.returnTo || '/';
    next();
}, passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html' }), (req, res) => {
    const redirectUrl = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(redirectUrl);
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ isLoggedIn: true, user: { name: req.user.displayName, email: req.user.emails[0].value } });
    } else {
        res.json({ isLoggedIn: false });
    }
});

// --- RUTAS HTML PRIVADAS ---
app.get('/cierre-formulario.html', (req, res) => {
    if (req.isAuthenticated()) res.sendFile(path.join(__dirname, 'private', 'cierre-formulario.html'));
    else res.redirect('/auth/google?returnTo=/cierre-formulario.html');
});
app.get('/consultas.html', (req, res) => {
    if (req.isAuthenticated()) res.sendFile(path.join(__dirname, 'private', 'consultas.html'));
    else res.redirect('/auth/google?returnTo=/consultas.html');
});
app.get('/api/config', (req, res) => res.json({ apiBaseUrl: API_BASE_URL }));

// --- HELPERS DE LECTURA (Optimizados) ---
async function getDataFromSpecificSheet(sheetIdentifier) {
    if (!doc) throw new Error('Google Sheet not initialized');
    let sheet;
    if (typeof sheetIdentifier === 'string') sheet = doc.sheetsByTitle[sheetIdentifier];
    else if (typeof sheetIdentifier === 'number') sheet = doc.sheetsByIndex[sheetIdentifier];
    if (!sheet) return [];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    return rows.map(row => {
        const rowData = {};
        sheet.headerValues.forEach(header => rowData[header] = row[header] || '');
        return rowData;
    });
}

async function getUltraOptimizedSheetData(sheetIdentifier, filters = {}) {
    if (!doc) throw new Error('Google Sheet not initialized');
    let sheet;
    if (typeof sheetIdentifier === 'string') sheet = doc.sheetsByTitle[sheetIdentifier];
    else if (typeof sheetIdentifier === 'number') sheet = doc.sheetsByIndex[sheetIdentifier];
    if (!sheet) return [];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    return rows
        .filter(row => {
            if (!filters.dni) return true;
            const rowDni = String(row['DNI'] || row['Documento'] || '').trim();
            return rowDni === String(filters.dni).trim();
        })
        .map(row => {
            const rowData = {};
            const essentialFields = ['DNI', 'Documento', 'Nombre', 'Apellido', 'Fecha', 'Prestador', 'Resultado'];
            sheet.headerValues.forEach(header => {
                if (essentialFields.includes(header) || header.includes('Link') || header.includes('PDF')) {
                    rowData[header] = row[header] || '';
                }
            });
            return rowData;
        });
}

// ====================================================================
// 🚀 RUTA MAGICA: GUARDAR SEGUIMIENTO (CORREGIDA Y DIRECTA)
// ====================================================================
app.post('/api/seguimiento/guardar', async (req, res) => {
    try {
        const data = req.body;
        console.log(`📝 Recibiendo seguimiento para DNI ${data.paciente.dni}`);

        if (!docSeguimiento) {
            return res.status(500).json({ success: false, error: 'Conexión con hoja de seguimiento no inicializada.' });
        }

        // Accedemos a la pestaña 'Seguimiento' del NUEVO documento
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) {
            return res.status(500).json({ success: false, error: 'La pestaña "Seguimiento" no existe en la hoja de destino.' });
        }

        // --- DICCIONARIO MAESTRO DE COLUMNAS ---
        const mapeoColumnas = {
            "Diabetes": "Diabetes", "Dislipemia": "Dislipemia", "Tabaquismo": "Tabaquismo",
            "Actividad Fisica": "Actividad_Fisica", "Actividad Física": "Actividad_Fisica",
            "Hipertension": "Hipertension", "Hipertensión": "Hipertension", "IMC": "IMC",
            "Agudeza Visual": "Agudeza_visual", "Agudeza visual": "Agudeza_visual",
            "Control Odontologico": "Control_Odontologico", "Control Odontológico": "Control_Odontologico",
            "Alimentacion Saludable": "Alimentacion_Saludable", "Alimentación Saludable": "Alimentacion_Saludable",
            "Prevencion de Caidas": "Prevencion_de_Caidas", "Prevención de Caídas": "Prevencion_de_Caidas",
            "Acido Folico": "Acido_Folico", "Ácido Fólico": "Acido_Folico",
            "Seguridad Vial": "Seguridad_Vial", "Consumo de Alcohol": "Consumo_de_Alcohol",
            "Violencia": "Violencia", "Depresion": "Depresion", "Depresión": "Depresion",
            "Infecciones de Transmision Sexual": "Infecciones_de_Transmision_Sexual", "ITS": "Infecciones_de_Transmision_Sexual",
            "Hepatitis B": "Hepatitis_B", "Hepatitis C": "Hepatitis_C", "VIH": "VIH",
            "Test de HPV": "Test_de_HPV", "Papanicolaou": "Papanicolaou", "SOMF": "SOMF",
            "Colonoscopia": "Colonoscopia", "Mamografia": "Mamografia", "Mamografía": "Mamografia",
            "PSA": "PSA", "ERC": "ERC", "EPOC": "EPOC",
            "Aneurisma aorta": "Aneurisma_aorta", "Aneurisma de Aorta": "Aneurisma_aorta",
            "Osteoporosis": "Osteoporosis", "Aspirina": "Aspirina", "Riesgo Cardiovascular": "Riesgo_Cardiovascular"
        };

        // Construimos la fila base
        const row = {
            'Fecha_Seguimiento': data.fecha,
            'DNI_Paciente': data.paciente.dni,
            'Nombre_Paciente': data.paciente.nombre,
            'Profesional_Apellido_Nombre': data.profesional.nombre,
            'Profesional_Matricula': data.profesional.matricula,
            'Observacion_Profesional': data.observacionProfesional
        };

        // Rellenamos dinámicamente según los motivos que llegan
        if (data.evaluaciones && Array.isArray(data.evaluaciones)) {
            data.evaluaciones.forEach(evaluacion => {
                let motivoKey = evaluacion.motivo;
                // Quitamos lo que está entre paréntesis para buscar en el mapa (ej: " (Pendiente)")
                const motivoSinParentesis = motivoKey.split('(')[0].trim();

                let columnaBase = mapeoColumnas[motivoKey] || mapeoColumnas[motivoSinParentesis];

                // Si no encuentra, intentamos normalizar tildes
                if (!columnaBase) {
                    const normalizado = motivoSinParentesis.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const keyMatch = Object.keys(mapeoColumnas).find(k => 
                       k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === normalizado
                    );
                    if (keyMatch) columnaBase = mapeoColumnas[keyMatch];
                }

                if (columnaBase) {
                    row[`${columnaBase}_Calificacion`] = evaluacion.calificacion;
                    row[`${columnaBase}_Observaciones`] = evaluacion.observaciones;
                }
            });
        }

        await sheet.addRow(row);
        console.log('✅ Seguimiento guardado correctamente en hoja externa.');
        res.json({ success: true, message: 'Guardado exitoso.' });

    } catch (error) {
        console.error('❌ Error guardando seguimiento:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// --- OTRAS RUTAS ORIGINALES (Manteniendo funcionalidad) ---
app.get('/obtener-campos', async (req, res) => {
    try {
        const data = await getDataFromSpecificSheet(0);
        if (data.length > 0) res.json(Object.keys(data[0]).filter(h => !h.startsWith('Observaciones')));
        else res.status(404).send('No data');
    } catch (e) { res.status(500).send('Error'); }
});

app.post('/buscar', async (req, res) => {
    try {
        const allData = await getDataFromSpecificSheet(0);
        const dni = String(req.body.dni).trim();
        const resultados = allData.filter(p => String(p['DNI'] || p['Documento'] || '').trim() === dni);
        
        if (resultados.length === 0) return res.json({ error: 'DNI no encontrado.' });

        // Ordenar por fecha (copiado de tu lógica original)
        const parseDate = (d) => {
             if(!d) return new Date(NaN);
             const p = d.split('/');
             return p.length===3 ? new Date(p[2], p[1]-1, p[0]) : new Date(NaN);
        };
        resultados.sort((a, b) => parseDate(b['Fecha_cierre_DP']).getTime() - parseDate(a['Fecha_cierre_DP']).getTime());

        res.json({ pacientePrincipal: resultados[0], estudiosPrevios: resultados.slice(1).map(e => ({ fecha: e['Fecha_cierre_DP'] })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/obtener-estudios-paciente', async (req, res) => {
    // Tu lógica original simplificada para usar las funciones de ayuda
    try {
        const { dni } = req.body;
        const hojas = ['Mamografia','Laboratorio','Ecografia','Espirometria','Densitometria','VCC','Biopsia','Odontologia','Enfermeria','Eco mamaria','Oftalmologia'];
        const estudiosEncontrados = [];
        
        for (const sheetName of hojas) {
            try {
                const sheetData = await getDataFromSpecificSheet(sheetName);
                const matches = sheetData.filter(r => String(r['DNI']||'').trim() === String(dni).trim());
                matches.forEach(m => {
                    // Mapeo simple para mantener tu estructura, ajusta si necesitas campos específicos de Lab/Enf
                    estudiosEncontrados.push({
                        TipoEstudio: sheetName,
                        Fecha: m['Fecha'] || 'N/A',
                        Prestador: m['Prestador'] || 'N/A',
                        Resultado: m['Resultado'] || m['Normal/Patologica'] || 'N/A',
                        LinkPDF: m['LinkPDF'] || m['Link al PDF'] || ''
                        // Nota: Si necesitas los campos detallados de laboratorio aquí, copia tu lógica específica del server original
                    });
                });
            } catch (e) { console.warn(`Hoja ${sheetName} no leída: ${e.message}`); }
        }
        res.json({ success: true, estudios: estudiosEncontrados });
    } catch (e) { res.status(500).json({ error: 'Error obteniendo estudios' }); }
});

// --- RUTAS DE ESCRITURA ANTIGUAS (Enfermería, Cierre, Consultas) ---
app.post('/api/enfermeria/guardar', async (req, res) => {
    try {
        const sheet = doc.sheetsByTitle["Enfermeria"];
        if (!sheet) return res.status(500).json({ message: 'Hoja Enfermeria no existe' });
        const row = req.body;
        row['Fecha_cierre_Enf'] = new Date().toLocaleDateString('es-AR');
        await sheet.addRow(row);
        res.json({ message: 'Datos guardados.' });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
});

app.post('/api/cierre/guardar', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'No autorizado' });
    try {
        const sheet = doc.sheetsByTitle['Hoja 1']; // Hoja de pacientes principal
        const data = req.body;
        data['Profesional'] = req.user.displayName;
        data['Fecha_cierre_DP'] = new Date().toLocaleDateString('es-AR');
        await sheet.addRow(data);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/guardar-consulta', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'No autorizado' });
    try {
        let sheet = doc.sheetsByTitle['Consultas'];
        if (!sheet) sheet = await doc.addSheet({ title: 'Consultas', headerValues: ['DNI','Nombre','Apellido','Edad','Sexo','Motivo de consulta','Diagnostico','Indicaciones','Recordatorio','Profesional','Fecha'] });
        const data = req.body;
        data['Profesional'] = req.user.displayName;
        data['Fecha'] = new Date().toLocaleString('es-AR');
        await sheet.addRow(data);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
});

// --- INICIO ---
initializeGoogleSheets().then(() => {
    app.listen(PORT, () => console.log(`✅ Servidor listo en ${API_BASE_URL}`));
});

// PRUEBA PARA GITHUB