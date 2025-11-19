// ====================================================================
// CONFIGURACIÓN
// ====================================================================
const ITEMS_FIJOS_DATA = [
    { titulo: 'Gestión Emocional', desc: 'Estrategias de afrontamiento y regulación.' },
    { titulo: 'Adherencia al Tratamiento', desc: 'Cumplimiento de pautas farmacológicas.' },
    { titulo: 'Redes de Apoyo', desc: 'Soporte social y familiar.' },
    { titulo: 'Actividad y Descanso', desc: 'Hábitos de sueño, alimentación y ejercicio.' }
];

function mostrarCargando(estado, txt='Procesando...') {
    const div = document.getElementById('loading-overlay');
    if(document.getElementById('loading-text')) document.getElementById('loading-text').textContent = txt;
    if(estado) { div.classList.remove('hidden'); div.classList.add('flex'); }
    else { div.classList.add('hidden'); div.classList.remove('flex'); }
}

function cleanId(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
}

function showModalMessage(msg, isError=false, callback=null) {
    const modal = document.getElementById('message-modal');
    const color = isError ? 'red' : 'green';
    modal.innerHTML = `
        <div class="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <div class="text-${color}-600 font-bold text-xl mb-2">${isError?'Error':'Éxito'}</div>
            <p class="text-gray-600 mb-4">${msg}</p>
            <button id="modal-ok" class="bg-${color}-600 text-white px-4 py-2 rounded hover:bg-${color}-700 w-full transition">Aceptar</button>
        </div>`;
    modal.classList.remove('hidden'); modal.classList.add('flex');
    document.getElementById('modal-ok').onclick = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex');
        if(callback) callback();
    };
}

// ====================================================================
// LÓGICA DE PDF E HISTORIAL
// ====================================================================

// 🔥 FUNCIÓN CORREGIDA: Genera el PDF visiblemente fuera de pantalla
async function generarPDF(data) {
    // 1. Llenar la plantilla
    document.getElementById('pdf-fecha').textContent = data.fecha;
    document.getElementById('pdf-paciente').textContent = data.paciente.nombre;
    document.getElementById('pdf-dni').textContent = data.paciente.dni;
    document.getElementById('pdf-profesional').textContent = data.profesional.nombre;
    document.getElementById('pdf-matricula').textContent = data.profesional.matricula;
    document.getElementById('pdf-observacion').textContent = data.observacionProfesional || "Sin observaciones registradas.";

    const tbody = document.getElementById('pdf-table-body');
    tbody.innerHTML = '';

    data.evaluaciones.forEach(item => {
        const tr = document.createElement('tr');
        let colorClass = 'text-gray-700';
        if (item.calificacion === 'Malo') colorClass = 'text-red-600 font-bold';
        else if (item.calificacion === 'Regular') colorClass = 'text-yellow-600 font-bold';
        else if (item.calificacion === 'Bueno') colorClass = 'text-green-600 font-bold';

        tr.innerHTML = `
            <td class="p-2 border border-gray-300 text-gray-800">${item.motivo}</td>
            <td class="p-2 border border-gray-300 ${colorClass}">${item.calificacion}</td>
            <td class="p-2 border border-gray-300 text-gray-600 italic text-sm">${item.observaciones || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    const element = document.getElementById('pdf-template');
    
    // 2. Configuración Óptima
    const opt = {
        margin:       0.5,
        filename:     `Informe_${data.paciente.dni}_${data.fecha}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false }, // useCORS ayuda con imágenes externas si las hubiera
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    // 3. EL TRUCO: Mostrarlo pero sacarlo de la vista del usuario
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '0px';
    element.style.display = 'block';

    // Esperar un momento para asegurar renderizado de estilos
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        await html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error("Error PDF:", err);
        alert("Hubo un problema generando el PDF. Intente nuevamente.");
    } finally {
        // 4. Restaurar estado oculto
        element.style.display = 'none';
        element.style.position = 'static';
    }
}

// Cargar historial
async function cargarHistorial(dni) {
    const lista = document.getElementById('history-list');
    lista.innerHTML = '<p class="text-gray-500 text-center py-4"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';

    try {
        const res = await fetch('/api/seguimiento/historial', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ dni })
        });
        const json = await res.json();

        if (!json.success || !json.historial || json.historial.length === 0) {
            lista.innerHTML = '<div class="bg-gray-100 p-4 rounded-lg text-center text-gray-500 text-sm">No hay informes anteriores registrados.</div>';
            return;
        }

        lista.innerHTML = ''; 

        json.historial.forEach(registro => {
            const item = document.createElement('div');
            item.className = 'flex justify-between items-center bg-white border border-gray-200 p-4 rounded-lg hover:bg-blue-50 transition shadow-sm';
            
            const fechaObj = new Date(registro.Fecha_Seguimiento);
            // Ajuste de zona horaria simple para visualización
            const fechaStr = isNaN(fechaObj) ? registro.Fecha_Seguimiento : fechaObj.toLocaleDateString('es-AR', { timeZone: 'UTC' });

            item.innerHTML = `
                <div>
                    <p class="font-bold text-gray-800 flex items-center">
                        <i class="far fa-calendar-alt mr-2 text-blue-500"></i> ${fechaStr}
                    </p>
                    <p class="text-xs text-gray-500 mt-1">Dr/a. ${registro.Profesional_Apellido_Nombre || 'N/A'}</p>
                </div>
                <button class="bg-white border border-blue-200 text-blue-600 hover:bg-blue-600 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center shadow-sm">
                    <i class="fas fa-file-pdf mr-2"></i> Ver Informe
                </button>
            `;

            item.querySelector('button').onclick = () => reconstruirYDescargar(registro);
            lista.appendChild(item);
        });

    } catch (e) {
        console.error(e);
        lista.innerHTML = '<p class="text-red-500 text-center text-sm">Error de conexión al cargar historial.</p>';
    }
}

// Reconstruye el objeto de datos para el PDF desde la fila plana
function reconstruirYDescargar(row) {
    const dataEstructurada = {
        fecha: row.Fecha_Seguimiento,
        paciente: { nombre: row.Nombre_Paciente, dni: row.DNI_Paciente },
        profesional: { nombre: row.Profesional_Apellido_Nombre, matricula: row.Profesional_Matricula },
        observacionProfesional: row.Observacion_Profesional,
        evaluaciones: []
    };

    Object.keys(row).forEach(key => {
        if (key.endsWith('_Calificacion') && row[key]) {
            const baseName = key.replace('_Calificacion', '');
            const nombreLimpio = baseName.replace(/_/g, ' '); 
            
            dataEstructurada.evaluaciones.push({
                motivo: nombreLimpio,
                calificacion: row[key],
                observaciones: row[`${baseName}_Observaciones`] || ''
            });
        }
    });

    mostrarCargando(true, "Generando documento...");
    setTimeout(() => {
        generarPDF(dataEstructurada).then(() => mostrarCargando(false));
    }, 500);
}


// ====================================================================
// INIT APP
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    const afiliadosNombreEl = document.getElementById('afiliado-nombre');
    const afiliadosDniEl = document.getElementById('afiliado-dni');
    
    // Cargar Datos Iniciales
    let currentPatient = null;
    try {
        currentPatient = JSON.parse(sessionStorage.getItem('currentPatientForSeguimiento'));
        const redFlags = JSON.parse(sessionStorage.getItem('redFlagsForSeguimiento'));
        
        if (currentPatient && redFlags) {
            afiliadosNombreEl.textContent = `${currentPatient.Apellido}, ${currentPatient.Nombre}`;
            afiliadosDniEl.textContent = currentPatient.DNI || currentPatient.Documento;
            document.getElementById('seguimiento-fecha').value = new Date().toISOString().split('T')[0];

            renderSeccion(document.getElementById('motivos-seguimiento-container'), redFlags, currentPatient, false);
            renderSeccion(document.getElementById('items-fijos-container'), ITEMS_FIJOS_DATA, currentPatient, true);
            
            cargarHistorial(currentPatient.DNI || currentPatient.Documento);

        } else throw new Error();
    } catch (e) {
        showModalMessage("Error: Datos de paciente no encontrados. Vuelva a iniciar.", true, () => window.location.href='/');
        return;
    }

    function renderSeccion(container, items, pData, esFijo) {
        container.innerHTML = '';
        if (!esFijo && (!items || items.length === 0)) {
            container.innerHTML = '<div class="bg-green-50 p-4 rounded-lg text-green-700 text-sm border border-green-100 flex items-center"><i class="fas fa-check-circle mr-2"></i> Sin alertas automáticas pendientes.</div>'; 
            return;
        }
        items.forEach(item => {
            const titulo = esFijo ? item.titulo : item;
            const desc = esFijo ? item.desc : (titulo === 'IMC' ? `Valor actual: ${pData.IMC}` : 'Alerta de seguimiento automático');
            const safeId = cleanId(titulo);
            
            const div = document.createElement('div');
            div.className = 'bg-gray-50 p-5 rounded-xl border border-gray-200 mb-4 evaluacion-item hover:shadow-md transition duration-200';
            div.innerHTML = `
                <div class="mb-3 border-b border-gray-200 pb-2">
                    <h4 class="font-bold text-lg text-blue-900 evaluacion-motivo" data-motivo-original="${titulo}">${titulo}</h4>
                    <p class="text-xs text-gray-500 font-medium uppercase tracking-wide">${desc}</p>
                </div>
                <div class="grid md:grid-cols-2 gap-6 text-sm">
                    <div>
                        <label class="block text-gray-600 font-semibold mb-2">Estado:</label>
                        <div class="flex flex-wrap gap-2">
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:bg-green-50 transition"><input type="radio" name="cal-${safeId}" value="Bueno" class="mr-2 text-green-600 focus:ring-green-500" checked> <span class="text-green-700 font-medium">Bueno</span></label>
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:bg-yellow-50 transition"><input type="radio" name="cal-${safeId}" value="Regular" class="mr-2 text-yellow-600 focus:ring-yellow-500"> <span class="text-yellow-700 font-medium">Regular</span></label>
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:bg-red-50 transition"><input type="radio" name="cal-${safeId}" value="Malo" class="mr-2 text-red-600 focus:ring-red-500"> <span class="text-red-700 font-medium">Malo</span></label>
                        </div>
                    </div>
                    <div>
                         <label class="block text-gray-600 font-semibold mb-2">Observación:</label>
                        <textarea id="obs-${safeId}" rows="2" class="border border-gray-300 rounded-lg p-2 w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition" placeholder="Escriba detalles aquí..."></textarea>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    }

    document.getElementById('guardar-seguimiento-btn').addEventListener('click', async () => {
        const pNom = document.getElementById('profesional-nombre').value.trim();
        const pMat = document.getElementById('profesional-matricula').value.trim();
        
        if(!pNom || !pMat) return showModalMessage("Por favor, complete los datos del profesional.", true);

        const payload = {
            fecha: document.getElementById('seguimiento-fecha').value,
            profesional: { nombre: pNom, matricula: pMat },
            paciente: { dni: afiliadosDniEl.textContent, nombre: afiliadosNombreEl.textContent },
            observacionProfesional: document.getElementById('observacion-profesional').value.trim(),
            evaluaciones: []
        };

        document.querySelectorAll('.evaluacion-item').forEach(el => {
            const titulo = el.querySelector('.evaluacion-motivo').dataset.motivoOriginal;
            const id = cleanId(titulo);
            const cal = el.querySelector(`input[name="cal-${id}"]:checked`);
            const obs = el.querySelector(`#obs-${id}`).value.trim();
            
            // Guardamos si hay observacion o si la calificacion no es la default (o siempre)
            if(cal || obs) {
                payload.evaluaciones.push({ motivo: titulo, calificacion: cal?.value||'', observaciones: obs||'' });
            }
        });

        mostrarCargando(true, "Guardando informe...");
        try {
            const res = await fetch('/api/seguimiento/guardar', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
            const json = await res.json();
            mostrarCargando(false);
            
            if(json.success) {
                if(confirm("✅ Informe guardado correctamente.\n\n¿Desea descargar el comprobante PDF ahora?")) {
                    generarPDF(payload);
                }
                cargarHistorial(currentPatient.DNI || currentPatient.Documento);
                // Limpiar formulario opcional
                document.getElementById('observacion-profesional').value = '';
            } else {
                showModalMessage("Error servidor: "+json.error, true);
            }
        } catch(e) {
            mostrarCargando(false);
            showModalMessage("Error de conexión con el servidor.", true);
        }
    });

    document.getElementById('refresh-history-btn').onclick = () => cargarHistorial(currentPatient.DNI || currentPatient.Documento);
    document.getElementById('cancelar-seguimiento-btn').onclick = () => { if(confirm("¿Cerrar formulario?")) window.close(); };
    document.getElementById('signout-btn').onclick = () => { if(confirm("¿Salir al inicio?")) window.location.href='/'; };
});