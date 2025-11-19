// ====================================================================
// FUNCIONES DE UTILIDAD
// ====================================================================

function mostrarCargando(estado, mensaje = 'Procesando...') {
    const body = document.body;
    let loadingDiv = document.getElementById('loading-overlay');

    // Estilos para el loader
    if (!document.getElementById('loader-style')) {
        const style = document.createElement('style');
        style.id = 'loader-style';
        style.innerHTML = `
            .loader { border-right-color: #3b82f6; animation: spinner 1s linear infinite; }
            @keyframes spinner { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
    }

    if (estado) {
        if (!loadingDiv) {
            loadingDiv = document.createElement('div');
            loadingDiv.id = 'loading-overlay';
            loadingDiv.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50';
            loadingDiv.innerHTML = `
                <div class="bg-white p-6 rounded-xl shadow-2xl flex items-center space-x-4">
                    <div class="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-8 w-8"></div>
                    <p class="text-gray-700 font-semibold"></p>
                </div>`;
            body.appendChild(loadingDiv);
        }
        loadingDiv.querySelector('p').textContent = mensaje;
        loadingDiv.style.display = 'flex';
    } else if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}

function showModalMessage(message, isError = false) {
    const existingModal = document.getElementById('message-modal');
    if (existingModal) existingModal.remove();

    const bgColor = isError ? 'bg-red-500' : 'bg-green-500';
    const modal = document.createElement('div');
    modal.id = 'message-modal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div class="${bgColor} text-white p-4 font-bold">${isError ? 'Atención' : 'Éxito'}</div>
            <div class="p-6">
                <p class="text-gray-700">${message}</p>
                <div class="mt-4 text-right">
                    <button id="close-modal-btn" class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">Cerrar</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#close-modal-btn').onclick = () => modal.remove();
}

// ====================================================================
// LÓGICA PRINCIPAL
// ====================================================================

document.addEventListener('DOMContentLoaded', () => {
    const afiliadoNombreSpan = document.getElementById('afiliado-nombre');
    const afiliadoDniSpan = document.getElementById('afiliado-dni');
    const motivosSeguimientoContainer = document.getElementById('motivos-seguimiento-container');
    const guardarSeguimientoBtn = document.getElementById('guardar-seguimiento-btn');
    const cancelarSeguimientoBtn = document.getElementById('cancelar-seguimiento-btn');
    const observacionProfesionalTextarea = document.getElementById('observacion-profesional');
    const seguimientoFechaInput = document.getElementById('seguimiento-fecha');
    
    // Fecha actual por defecto
    const today = new Date();
    seguimientoFechaInput.value = today.toISOString().split('T')[0];

    // Cargar datos
    let currentPatientData = null;
    try {
        currentPatientData = JSON.parse(sessionStorage.getItem('currentPatientForSeguimiento'));
        const redFlagsData = JSON.parse(sessionStorage.getItem('redFlagsForSeguimiento'));

        if (currentPatientData && redFlagsData) {
            afiliadoNombreSpan.textContent = `${currentPatientData.Apellido || ''}, ${currentPatientData.Nombre || ''}`;
            afiliadoDniSpan.textContent = currentPatientData.DNI || currentPatientData.Documento || 'No especificado';
            renderMotivosSeguimiento(redFlagsData, currentPatientData);
        } else {
            throw new Error("Datos incompletos");
        }
    } catch (e) {
        showModalMessage('No hay datos del paciente. Vuelva al inicio.', true);
        guardarSeguimientoBtn.disabled = true;
    }

    // --- FUNCIÓN DE LIMPIEZA DE IDs (LA SOLUCIÓN AL CRASH) ---
    function cleanId(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quita tildes
                  .replace(/[^a-zA-Z0-9]/g, ""); // Quita todo lo que no sea letra o número (incluyendo espacios y paréntesis)
    }

    function renderMotivosSeguimiento(motivos, patientData) {
        motivosSeguimientoContainer.innerHTML = ''; 
        if (!motivos || motivos.length === 0) {
            motivosSeguimientoContainer.innerHTML = '<p class="text-gray-600">Sin puntos de seguimiento.</p>';
            return;
        }

        motivos.forEach(motivo => {
            const motivoDiv = document.createElement('div');
            motivoDiv.className = 'bg-blue-50 p-4 rounded-lg shadow-sm border border-blue-200 mb-4 evaluacion-item';
            
            // ID limpio para el HTML
            const safeId = cleanId(motivo); 
            
            // Texto bonito para mostrar
            let displayMotivo = motivo;
            if (motivo === 'IMC' && patientData?.IMC) {
                 displayMotivo = `IMC (${patientData.IMC})`;
            }

            motivoDiv.innerHTML = `
                <h4 class="text-lg font-semibold text-blue-800 mb-2 evaluacion-motivo" data-motivo-original="${motivo}">${displayMotivo}</h4> 
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-gray-700 text-sm font-bold mb-2">Calificación:</label>
                        <div class="flex items-center space-x-4">
                            <label class="inline-flex items-center">
                                <input type="radio" class="form-radio text-green-600" name="calificacion-${safeId}" value="Bueno" checked>
                                <span class="ml-2">Bueno</span>
                            </label>
                            <label class="inline-flex items-center">
                                <input type="radio" class="form-radio text-yellow-600" name="calificacion-${safeId}" value="Regular">
                                <span class="ml-2">Regular</span>
                            </label>
                            <label class="inline-flex items-center">
                                <input type="radio" class="form-radio text-red-600" name="calificacion-${safeId}" value="Malo">
                                <span class="ml-2">Malo</span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <label for="obs-${safeId}" class="block text-gray-700 text-sm font-bold mb-2">Observaciones:</label>
                        <textarea id="obs-${safeId}" rows="2" class="shadow appearance-none border rounded w-full py-2 px-3 focus:outline-none focus:shadow-outline"></textarea>
                    </div>
                </div>
            `;
            motivosSeguimientoContainer.appendChild(motivoDiv);
        });
    }

    guardarSeguimientoBtn.addEventListener('click', async () => {
        const profesionalNombre = document.getElementById('profesional-nombre').value.trim();
        const profesionalMatricula = document.getElementById('profesional-matricula').value.trim();
        
        if (!profesionalNombre || !profesionalMatricula) {
            return showModalMessage('Complete nombre y matrícula del profesional.', true);
        }

        const seguimientoData = {
            fecha: seguimientoFechaInput.value,
            profesional: { nombre: profesionalNombre, matricula: profesionalMatricula },
            paciente: { dni: afiliadoDniSpan.textContent, nombre: afiliadoNombreSpan.textContent },
            evaluaciones: [],
            observacionProfesional: observacionProfesionalTextarea.value.trim()
        };

        // Recolección de datos usando selectores seguros
        document.querySelectorAll('.evaluacion-item').forEach(item => {
            const motivoTitle = item.querySelector('.evaluacion-motivo');
            const motivoOriginal = motivoTitle.getAttribute('data-motivo-original'); // Usamos el original (ej: "Prevención...")
            const safeId = cleanId(motivoOriginal); // Generamos el mismo ID limpio para buscar los inputs

            const calificacionEl = item.querySelector(`input[name="calificacion-${safeId}"]:checked`);
            const obsEl = item.querySelector(`#obs-${safeId}`);

            if (calificacionEl || (obsEl && obsEl.value.trim())) {
                seguimientoData.evaluaciones.push({
                    motivo: motivoOriginal, // Enviamos el nombre original al servidor
                    calificacion: calificacionEl ? calificacionEl.value : '',
                    observaciones: obsEl ? obsEl.value.trim() : ''
                });
            }
        });

        try {
            mostrarCargando(true, "Guardando datos...");
            // Enviamos directamente al servidor Node, no a Apps Script
            const response = await fetch('/api/seguimiento/guardar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(seguimientoData)
            });

            const result = await response.json();
            mostrarCargando(false);

            if (result.success) {
                showModalMessage('Informe guardado correctamente.');
                setTimeout(() => window.close(), 2000); // Cerrar ventana tras éxito opcional
            } else {
                showModalMessage('Error: ' + (result.error || 'Desconocido'), true);
            }
        } catch (error) {
            mostrarCargando(false);
            console.error(error);
            showModalMessage('Error de conexión con el servidor.', true);
        }
    });

    cancelarSeguimientoBtn.addEventListener('click', () => {
        if (confirm('¿Salir sin guardar?')) window.close();
    });
});