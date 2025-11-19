require('dotenv').config();
const express = require('express');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { google } = require('googleapis');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const v8 = require('v8');

// --- CONFIGURACIÓN DE MEMORIA ---
v8.setFlagsFromString('--max-old-space-size=8192');
setInterval(() => { if (global.gc) global.gc(); }, 30000);

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// --- CONSTANTES ---
const PACIENTES_SHEET_ID = '15YPfBG9PBfN3nBW5xXJYjIXEgYIS9z71pI0VpeCtAAU'; // Lectura
const SEGUIMIENTO_SHEET_ID = '1Yoxu-UgFcU09AWznbQEx9pZGcUQo9gINiVHOhuwfFZ8'; // Escritura

// --- LISTA MAESTRA DE TEMAS (Incluye los 4 Fijos nuevos) ---
const TEMAS_MAESTROS = [
    "Diabetes", "Dislipemia", "Tabaquismo", "Actividad_Fisica", 
    "Hipertension", "IMC", "Agudeza_visual", "Control_Odontologico", 
    "Alimentacion_Saludable", "Prevencion_de_Caidas", "Acido_Folico", 
    "Seguridad_Vial", "Consumo_de_Alcohol", "Violencia", "Depresion", 
    "Infecciones_de_Transmision_Sexual", "Hepatitis_B", "Hepatitis_C", 
    "VIH", "Test_de_HPV", "Papanicolaou", "SOMF", "Colonoscopia", 
    "Mamografia", "PSA", "ERC", "EPOC", "Aneurisma_aorta", 
    "Osteoporosis", "Aspirina", "Riesgo_Cardiovascular",
    // --- ITEMS FIJOS NUEVOS ---
    "Gestion_Emocional",
    "Adherencia_Tratamiento",
    "Redes_Apoyo",
    "Actividad_Descanso"
];

let doc; 
let docSeguimiento;
let credentials;

app.use(express.json());
app.use(express.static('public'));
app.use(session({ secret: 'tu-secreto-seguro', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// --- FUNCIÓN CONFIGURAR COLUMNAS ---
async function configurarColumnasHoja() {
    if (!docSeguimiento) return;
    try {
        await docSeguimiento.loadInfo();
        let sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        const headers = ['Fecha_Seguimiento', 'DNI_Paciente', 'Nombre_Paciente', 'Profesional_Apellido_Nombre', 'Profesional_Matricula'];
        
        TEMAS_MAESTROS.forEach(tema => {
            headers.push(`${tema}_Calificacion`);
            headers.push(`${tema}_Observaciones`);
        });
        headers.push('Observacion_Profesional');

        if (!sheet) {
            sheet = await docSeguimiento.addSheet({ title: 'Seguimiento', headerValues: headers });
        } else {
            await sheet.loadHeaderRow();
            if (!sheet.headerValues || sheet.headerValues.length === 0) await sheet.setHeaderRow(headers);
        }
        console.log(`✅ Hoja lista con campos fijos y variables.`);
    } catch (error) { console.error('⚠️ Error config columnas:', error.message); }
}

async function initializeGoogleSheets() {
    try {
        if (process.env.CREDENTIALS_JSON) credentials = JSON.parse(process.env.CREDENTIALS_JSON);
        else credentials = require('./credentials.json');
        
        doc = new GoogleSpreadsheet(PACIENTES_SHEET_ID);
        await doc.useServiceAccountAuth({ client_email: credentials.client_email, private_key: credentials.private_key.replace(/\\n/g, '\n') });
        await doc.loadInfo();

        docSeguimiento = new GoogleSpreadsheet(SEGUIMIENTO_SHEET_ID);
        await docSeguimiento.useServiceAccountAuth({ client_email: credentials.client_email, private_key: credentials.private_key.replace(/\\n/g, '\n') });
        await configurarColumnasHoja();
        
        console.log('✅ Hojas cargadas.');
    } catch (error) { console.error('❌ Error Sheets:', error); process.exit(1); }
}

// --- RUTAS AUTH ---
app.get('/auth/google', (req, res, next) => { req.session.returnTo = req.query.returnTo || '/'; next(); }, passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login.html' }), (req, res) => { const url = req.session.returnTo || '/'; delete req.session.returnTo; res.redirect(url); });
passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.GOOGLE_CALLBACK_URL }, (a, r, p, d) => d(null, p)));
passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
app.get('/api/user', (req, res) => req.isAuthenticated() ? res.json({ isLoggedIn: true, user: { name: req.user.displayName, email: req.user.emails[0].value } }) : res.json({ isLoggedIn: false }));
app.get('/api/config', (req, res) => res.json({ apiBaseUrl: API_BASE_URL }));

async function getDataFromSpecificSheet(sheetIdentifier) {
    if (!doc) throw new Error('Google Sheet not initialized');
    let sheet = typeof sheetIdentifier === 'string' ? doc.sheetsByTitle[sheetIdentifier] : doc.sheetsByIndex[sheetIdentifier];
    if (!sheet) return [];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    return rows.map(row => { const d = {}; sheet.headerValues.forEach(h => d[h] = row[h] || ''); return d; });
}

// --- GUARDAR SEGUIMIENTO ---
app.post('/api/seguimiento/guardar', async (req, res) => {
    try {
        const data = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false, error: 'Error conexión hoja.' });
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
            // --- NUEVOS MAPEOS FIJOS ---
            "Gestión Emocional": "Gestion_Emocional", "Adherencia al Tratamiento": "Adherencia_Tratamiento",
            "Redes de Apoyo": "Redes_Apoyo", "Actividad y Descanso": "Actividad_Descanso"
        };

        const row = {
            'Fecha_Seguimiento': data.fecha, 'DNI_Paciente': data.paciente.dni,
            'Nombre_Paciente': data.paciente.nombre, 'Profesional_Apellido_Nombre': data.profesional.nombre,
            'Profesional_Matricula': data.profesional.matricula, 'Observacion_Profesional': data.observacionProfesional
        };

        if (data.evaluaciones && Array.isArray(data.evaluaciones)) {
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
    } catch (error) { console.error('❌ Error guardando:', error); res.status(500).json({ success: false, error: error.message }); }
});

// --- LECTURA ---
app.post('/buscar', async (req, res) => {
    try {
        const all = await getDataFromSpecificSheet(0);
        const dni = String(req.body.dni).trim();
        const resu = all.filter(p => String(p['DNI']||p['Documento']||'').trim() === dni);
        if (resu.length === 0) return res.json({ error: 'DNI no encontrado.' });
        const parseDate = (d) => { if(!d) return new Date(NaN); const p = d.split('/'); return p.length===3 ? new Date(p[2], p[1]-1, p[0]) : new Date(NaN); };
        resu.sort((a, b) => parseDate(b['Fecha_cierre_DP']).getTime() - parseDate(a['Fecha_cierre_DP']).getTime());
        res.json({ pacientePrincipal: resu[0], estudiosPrevios: resu.slice(1).map(e => ({ fecha: e['Fecha_cierre_DP'] })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/obtener-estudios-paciente', async (req, res) => {
    try {
        const { dni } = req.body;
        const hojas = ['Mamografia','Laboratorio','Ecografia','Espirometria','Densitometria','VCC','Biopsia','Odontologia','Enfermeria','Eco mamaria','Oftalmologia'];
        const estudios = [];
        for (const h of hojas) {
            try {
                const d = await getDataFromSpecificSheet(h);
                d.filter(r => String(r['DNI']||'').trim() === String(dni).trim()).forEach(m => {
                    estudios.push({ TipoEstudio: h, Fecha: m['Fecha']||'N/A', Prestador: m['Prestador']||'N/A', Resultado: m['Resultado']||m['Normal/Patologica']||'N/A', LinkPDF: m['LinkPDF']||m['Link al PDF']||'' });
                });
            } catch (e) {}
        }
        res.json({ success: true, estudios });
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/enfermeria/guardar', async (req, res) => {
    try {
        const s = doc.sheetsByTitle["Enfermeria"];
        if (!s) return res.status(500).json({ message: 'No existe hoja' });
        const r = req.body; r['Fecha_cierre_Enf'] = new Date().toLocaleDateString('es-AR');
        await s.addRow(r); res.json({ message: 'Guardado' });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
});

// --- NUEVA RUTA: OBTENER HISTORIAL DE SEGUIMIENTOS ---
app.post('/api/seguimiento/historial', async (req, res) => {
    try {
        const { dni } = req.body;
        if (!docSeguimiento) return res.status(500).json({ success: false, error: 'Error conexión hoja.' });
        
        const sheet = docSeguimiento.sheetsByTitle['Seguimiento'];
        if (!sheet) return res.json({ success: true, historial: [] }); // Si no existe la hoja aún, retorna vacío

        // Optimizacion: Cargar solo lo necesario
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        // Filtramos por DNI
        const historial = rows
            .filter(row => String(row['DNI_Paciente']).trim() === String(dni).trim())
            .map(row => {
                // Convertimos la fila plana de Google Sheet a un objeto JSON estructurado
                // Esto es necesario para que el frontend pueda reconstruir el informe
                const rawData = {};
                sheet.headerValues.forEach(header => {
                    rawData[header] = row[header];
                });
                return rawData;
            });

        // Ordenar por fecha descendente (el más nuevo primero)
        // Asumimos formato YYYY-MM-DD del input date, o lo parseamos si es DD/MM/YYYY
        historial.sort((a, b) => new Date(b.Fecha_Seguimiento) - new Date(a.Fecha_Seguimiento));

        res.json({ success: true, historial });

    } catch (error) {
        console.error('❌ Error obteniendo historial:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- INICIO ---
initializeGoogleSheets().then(() => {
    app.listen(PORT, () => console.log(`✅ Servidor listo en ${API_BASE_URL}`));
});
