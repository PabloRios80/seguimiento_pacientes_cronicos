// ====================================================================
// CONFIGURACIÓN
// ====================================================================
const ITEMS_FIJOS_DATA = [
  {
    titulo: "Gestión Emocional",
    desc: "Estrategias de afrontamiento y regulación.",
  },
  {
    titulo: "Adherencia al Tratamiento",
    desc: "Cumplimiento de pautas farmacológicas.",
  },
  { titulo: "Redes de Apoyo", desc: "Soporte social y familiar." },
  {
    titulo: "Actividad y Descanso",
    desc: "Hábitos de sueño, alimentación y ejercicio.",
  },
];

function mostrarCargando(estado, txt = "Procesando...") {
  const div = document.getElementById("loading-overlay");
  if (document.getElementById("loading-text"))
    document.getElementById("loading-text").textContent = txt;
  if (estado) {
    div.classList.remove("hidden");
    div.classList.add("flex");
  } else {
    div.classList.add("hidden");
    div.classList.remove("flex");
  }
}

function cleanId(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

function showModalMessage(msg, isError = false, callback = null) {
  const modal = document.getElementById("message-modal");
  const color = isError ? "rose" : "emerald";
  const icon = isError ? "fa-exclamation-circle" : "fa-check-circle";

  modal.innerHTML = `
        <div class="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl transform transition-all scale-100 border border-slate-100">
            <div class="text-center mb-4">
                <div class="mx-auto w-16 h-16 bg-${color}-100 rounded-full flex items-center justify-center mb-4">
                    <i class="fas ${icon} text-2xl text-${color}-500"></i>
                </div>
                <h3 class="text-xl font-black text-slate-800">${isError ? "Atención" : "¡Éxito!"}</h3>
            </div>
            <p class="text-slate-500 mb-6 text-center leading-relaxed">${msg}</p>
            <button id="modal-ok" class="bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 w-full font-bold transition shadow-lg shadow-slate-200">
                ${isError ? "Entendido" : "Aceptar"}
            </button>
        </div>`;
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  const okBtn = document.getElementById("modal-ok");
  // Evitamos acumulación de eventos
  okBtn.onclick = () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    if (callback) callback();
  };
}

// ====================================================================
// VISOR DE HISTORIAL
// ====================================================================

function abrirModalResumen(data) {
  const fechaStr = data.fecha;
  const profNombre = data.profesional.nombre || "Desconocido";
  const pacNombre = data.paciente.nombre || "Paciente";

  document.getElementById("modal-paciente-nombre").textContent = pacNombre;
  document.getElementById("modal-fecha-profesional").innerHTML = `
        <span class="font-bold text-slate-700"><i class="far fa-calendar-alt mr-1 text-blue-500"></i> ${fechaStr}</span> 
        <span class="mx-2 text-slate-300">|</span> 
        <span class="text-slate-500">Atendido por: <strong class="text-slate-700">${profNombre}</strong></span>
    `;

  const alertas = data.evaluaciones.filter(
    (item) =>
      item.calificacion === "Malo" ||
      item.calificacion === "Regular" ||
      (item.observaciones && item.observaciones.trim().length > 0),
  );

  const container = document.getElementById("modal-lista-alertas");
  const sinAlertasMsg = document.getElementById("modal-sin-alertas");
  container.innerHTML = "";

  if (alertas.length === 0) {
    sinAlertasMsg.classList.remove("hidden");
  } else {
    sinAlertasMsg.classList.add("hidden");
    alertas.forEach((item) => {
      const div = document.createElement("div");
      let colorClass = "bg-indigo-50 border-indigo-100";
      let textTitle = "text-indigo-900";
      let badgeColor = "bg-indigo-200 text-indigo-800";

      if (item.calificacion === "Malo") {
        colorClass = "bg-rose-50 border-rose-100";
        textTitle = "text-rose-900";
        badgeColor = "bg-rose-200 text-rose-900";
      } else if (item.calificacion === "Regular") {
        colorClass = "bg-amber-50 border-amber-100";
        textTitle = "text-amber-900";
        badgeColor = "bg-amber-200 text-amber-900";
      }

      div.className = `p-4 rounded-xl border ${colorClass} mb-3 shadow-sm`;
      div.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <strong class="text-sm font-bold uppercase tracking-wide ${textTitle}">${item.motivo}</strong>
                    <span class="text-[10px] font-black ${badgeColor} px-2 py-1 rounded-md uppercase tracking-wider shadow-sm">${item.calificacion}</span>
                </div>
                ${item.observaciones ? `<div class="text-sm text-slate-600 italic border-t border-black/5 pt-2 mt-1 flex items-start"><i class="fas fa-pen text-xs mt-1 mr-2 opacity-50"></i> <span>${item.observaciones}</span></div>` : ""}
            `;
      container.appendChild(div);
    });
  }

  document.getElementById("modal-observacion-texto").textContent =
    data.observacionProfesional || "Sin indicaciones adicionales.";
  const modal = document.getElementById("ver-resumen-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function cerrarModalResumen() {
  const modal = document.getElementById("ver-resumen-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

// ====================================================================
// CARGA DE DATOS
// ====================================================================

async function cargarHistorial(dni) {
  const lista = document.getElementById("history-list");
  lista.innerHTML =
    '<div class="bg-slate-50 p-4 rounded-xl text-center border border-slate-100"><i class="fas fa-spinner fa-spin text-blue-500 mb-2 text-2xl"></i><p class="text-slate-400 text-sm">Consultando base de datos...</p></div>';

  try {
    const res = await fetch("/api/seguimiento/historial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni }),
    });
    const json = await res.json();

    if (!json.success || !json.historial || json.historial.length === 0) {
      lista.innerHTML =
        '<div class="bg-slate-50 p-6 rounded-xl border border-dashed border-slate-200 text-center text-slate-400"><i class="fas fa-folder-open text-2xl mb-2 opacity-50"></i><p>No hay informes anteriores.</p></div>';
      return;
    }

    lista.innerHTML = "";

    json.historial.forEach((registro) => {
      const item = document.createElement("div");
      item.className =
        "flex justify-between items-center bg-white border border-slate-100 p-4 rounded-xl hover:shadow-md hover:border-blue-200 transition duration-200 group cursor-pointer";

      const fObj = new Date(registro.Fecha_Seguimiento);
      const fStr = isNaN(fObj)
        ? registro.Fecha_Seguimiento
        : fObj.toLocaleDateString("es-AR", { timeZone: "UTC" });

      item.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="bg-blue-50 text-blue-600 w-12 h-12 rounded-xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition duration-300 shadow-sm">
                        <i class="fas fa-file-medical-alt text-lg"></i>
                    </div>
                    <div>
                        <p class="font-bold text-slate-700 text-sm flex items-center gap-2">
                            ${fStr}
                        </p>
                        <p class="text-xs text-slate-400 mt-0.5 font-medium">Dr/a. ${registro.Profesional_Apellido_Nombre || "N/A"}</p>
                    </div>
                </div>
                <button class="text-blue-600 hover:text-blue-800 text-xs font-bold uppercase tracking-wide flex items-center bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition">
                    Ver <i class="fas fa-chevron-right ml-2"></i>
                </button>
            `;
      item.onclick = () => reconstruirYMostrar(registro);
      lista.appendChild(item);
    });
  } catch (e) {
    console.error(e);
    lista.innerHTML =
      '<p class="text-red-400 text-center text-xs bg-red-50 p-2 rounded">Error de conexión.</p>';
  }
}

function reconstruirYMostrar(row) {
  const dataEstructurada = {
    fecha: row.Fecha_Seguimiento,
    paciente: { nombre: row.Nombre_Paciente, dni: row.DNI_Paciente },
    profesional: {
      nombre: row.Profesional_Apellido_Nombre,
      matricula: row.Profesional_Matricula,
    },
    observacionProfesional: row.Observacion_Profesional,
    evaluaciones: [],
  };
  Object.keys(row).forEach((key) => {
    if (key.endsWith("_Calificacion") && row[key]) {
      const baseName = key.replace("_Calificacion", "");
      const nombreLimpio = baseName.replace(/_/g, " ");
      dataEstructurada.evaluaciones.push({
        motivo: nombreLimpio,
        calificacion: row[key],
        observaciones: row[`${baseName}_Observaciones`] || "",
      });
    }
  });
  abrirModalResumen(dataEstructurada);
}

// ====================================================================
// INIT
// ====================================================================
document.addEventListener("DOMContentLoaded", () => {
  const afiliadosNombreEl = document.getElementById("afiliado-nombre");
  const afiliadosDniEl = document.getElementById("afiliado-dni");

  document
    .getElementById("close-resumen-btn")
    .addEventListener("click", cerrarModalResumen);
  document
    .getElementById("btn-cerrar-modal-inferior")
    .addEventListener("click", cerrarModalResumen);
  document
    .getElementById("print-btn")
    .addEventListener("click", () => window.print());

  let currentPatient = null;
  try {
    currentPatient = JSON.parse(
      sessionStorage.getItem("currentPatientForSeguimiento"),
    );
    const redFlags = JSON.parse(
      sessionStorage.getItem("redFlagsForSeguimiento"),
    );
    if (currentPatient && redFlags) {
      afiliadosNombreEl.textContent = `${currentPatient.Apellido}, ${currentPatient.Nombre}`;
      afiliadosDniEl.textContent =
        currentPatient.DNI || currentPatient.Documento;
      document.getElementById("seguimiento-fecha").value = new Date()
        .toISOString()
        .split("T")[0];
      renderSeccion(
        document.getElementById("motivos-seguimiento-container"),
        redFlags,
        currentPatient,
        false,
      );
      renderSeccion(
        document.getElementById("items-fijos-container"),
        ITEMS_FIJOS_DATA,
        currentPatient,
        true,
      );
      cargarHistorial(currentPatient.DNI || currentPatient.Documento);
    } else throw new Error();
  } catch (e) {
    showModalMessage(
      "Error: Datos no encontrados.",
      true,
      () => (window.location.href = "/"),
    );
    return;
  }

  function renderSeccion(container, items, pData, esFijo) {
    container.innerHTML = "";
    if (!esFijo && (!items || items.length === 0)) {
      container.innerHTML =
        '<div class="bg-emerald-50 p-4 rounded-xl text-emerald-700 text-sm border border-emerald-100 flex items-center justify-center shadow-sm"><i class="fas fa-check-circle mr-2 text-lg"></i> Sin alertas automáticas pendientes.</div>';
      return;
    }
    items.forEach((item) => {
      const titulo = esFijo ? item.titulo : item;
      const desc = esFijo
        ? item.desc
        : titulo === "IMC"
          ? `Valor actual: ${pData.IMC}`
          : "Alerta de seguimiento automático";
      const safeId = cleanId(titulo);

      const div = document.createElement("div");
      let borderColor = esFijo ? "border-teal-200" : "border-rose-200";
      let iconColor = esFijo ? "text-teal-600" : "text-rose-600";
      let bgTitle = esFijo ? "bg-teal-100" : "bg-rose-100";
      let titleColor = esFijo ? "text-teal-900" : "text-rose-900";

      div.className = `bg-white p-5 rounded-2xl border ${borderColor} mb-5 evaluacion-item shadow-sm hover:shadow-md transition duration-300`;

      div.innerHTML = `
                <div class="flex items-start gap-4 mb-4">
                    <div class="mt-1 ${bgTitle} p-2 rounded-lg ${iconColor}">
                        <i class="fas ${esFijo ? "fa-clipboard-list" : "fa-exclamation-triangle"}"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-lg ${titleColor} evaluacion-motivo leading-tight" data-motivo-original="${titulo}">${titulo}</h4>
                        <p class="text-xs text-slate-400 font-medium uppercase tracking-wide mt-1">${desc}</p>
                    </div>
                </div>

                <div class="grid md:grid-cols-2 gap-6 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div>
                        <label class="block text-slate-500 font-bold mb-2 text-xs uppercase tracking-wider">Estado</label>
                        <div class="flex flex-wrap gap-2">
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:border-green-400 hover:shadow-sm transition group">
                                <input type="radio" name="cal-${safeId}" value="Bueno" class="mr-2 accent-green-600" checked> 
                                <span class="text-slate-600 font-medium group-hover:text-green-600">Bueno</span>
                            </label>
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:border-yellow-400 hover:shadow-sm transition group">
                                <input type="radio" name="cal-${safeId}" value="Regular" class="mr-2 accent-yellow-500"> 
                                <span class="text-slate-600 font-medium group-hover:text-yellow-600">Regular</span>
                            </label>
                            <label class="cursor-pointer flex items-center bg-white px-3 py-2 rounded-lg border hover:border-red-400 hover:shadow-sm transition group">
                                <input type="radio" name="cal-${safeId}" value="Malo" class="mr-2 accent-red-600"> 
                                <span class="text-slate-600 font-medium group-hover:text-red-600">Malo</span>
                            </label>
                        </div>
                    </div>
                    <div>
                         <label class="block text-slate-500 font-bold mb-2 text-xs uppercase tracking-wider">Observación</label>
                        <textarea id="obs-${safeId}" rows="2" class="border border-slate-200 rounded-lg p-2.5 w-full focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 bg-white transition text-slate-700 placeholder-slate-300 text-sm" placeholder="Escriba detalles aquí..."></textarea>
                    </div>
                </div>
            `;
      container.appendChild(div);
    });
    // ── VER ESTUDIOS ──
    const verEstudiosBtn = document.getElementById("ver-estudios-btn");
    const estudiosModal = document.getElementById("estudios-modal");
    const estudiosModalContent = document.getElementById(
      "estudios-modal-content",
    );
    const estudiosModalDni = document.getElementById("estudios-modal-dni");
    let allEstudios = [];

    [
      document.getElementById("close-estudios-modal"),
      document.getElementById("close-estudios-modal-bottom"),
    ].forEach((btn) => {
      btn?.addEventListener("click", () => {
        estudiosModal.classList.add("hidden");
        estudiosModal.classList.remove("flex");
      });
    });

    verEstudiosBtn?.addEventListener("click", async () => {
      const dni = currentPatient.DNI || currentPatient.Documento;
      estudiosModalDni.textContent = dni;
      estudiosModalContent.innerHTML =
        '<p class="text-center text-gray-500 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando estudios...</p>';
      estudiosModal.classList.remove("hidden");
      estudiosModal.classList.add("flex");

      const token = localStorage.getItem("dpToken");
      console.log(
        "Token encontrado:",
        token ? "SÍ" : "NO",
        token?.substring(0, 20),
      );

      try {
        const token = localStorage.getItem("dpToken");
        const res = await fetch(
          "https://acceso.diapreventivoiapos.com/api/estudios-paciente",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({ dni }),
          },
        );
        const data = await res.json();

        if (!data.success || !data.estudios?.length) {
          estudiosModalContent.innerHTML =
            '<p class="text-center text-gray-400 py-8">No se encontraron estudios previos.</p>';
          return;
        }

        allEstudios = data.estudios;
        let html =
          '<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr class="bg-gray-50"><th class="py-2 px-4 border-b text-left">Tipo</th><th class="py-2 px-4 border-b text-left">Fecha</th><th class="py-2 px-4 border-b text-center">Acción</th></tr></thead><tbody>';
        data.estudios.forEach((e, i) => {
          html += `<tr><td class="py-2 px-4 border-b">${e.TipoEstudio || "N/A"}</td><td class="py-2 px-4 border-b">${e.Fecha || "N/A"}</td><td class="py-2 px-4 border-b text-center"><button class="ver-estudio-btn bg-purple-100 text-purple-700 hover:bg-purple-200 font-bold py-1 px-3 rounded text-xs" data-index="${i}">Ver</button></td></tr>`;
        });
        html += "</tbody></table></div>";
        estudiosModalContent.innerHTML = html;
      } catch (e) {
        estudiosModalContent.innerHTML =
          '<p class="text-center text-red-500 py-8">Error al cargar estudios.</p>';
      }
    });

    estudiosModalContent?.addEventListener("click", (e) => {
      const btn = e.target.closest(".ver-estudio-btn");
      if (!btn) return;
      const estudio = allEstudios[parseInt(btn.dataset.index)];
      if (!estudio) return;

      let html = `<div class="p-4"><h4 class="font-bold text-lg text-purple-700 border-b pb-2 mb-3">${estudio.TipoEstudio}</h4>
    <p class="text-sm text-gray-500 mb-4">Fecha: ${estudio.Fecha || "N/A"} | Prestador: ${estudio.Prestador || "N/A"}</p>`;
      if (estudio.Resultado)
        html += `<p class="mb-2"><strong>Resultado:</strong> ${estudio.Resultado}</p>`;
      if (estudio.Observaciones)
        html += `<p class="mb-2"><strong>Observaciones:</strong> ${estudio.Observaciones}</p>`;
      const resultados =
        estudio.ResultadosLaboratorio || estudio.ResultadosEnfermeria;
      if (resultados) {
        html += '<table class="min-w-full text-sm mt-2">';
        for (const [k, v] of Object.entries(resultados)) {
          if (v && v !== "" && v !== "N/A")
            html += `<tr class="border-b"><td class="py-1 font-semibold pr-4 capitalize">${k.replace(/_/g, " ")}:</td><td class="py-1">${v}</td></tr>`;
        }
        html += "</table>";
      }
      const links =
        estudio.LinksPDF?.filter((l) => l) ||
        (estudio.LinkPDF ? [estudio.LinkPDF] : []);
      if (links.length) {
        html += '<div class="mt-4">';
        links.forEach((l, i) => {
          html += `<a href="${l}" target="_blank" class="inline-block bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 mr-2 mt-2"><i class="fas fa-file-pdf mr-1"></i>Ver PDF ${links.length > 1 ? i + 1 : ""}</a>`;
        });
        html += "</div>";
      }
      html += "</div>";
      estudiosModalContent.innerHTML = html;
    });
  }

  document
    .getElementById("guardar-seguimiento-btn")
    .addEventListener("click", async () => {
      const pNom = document.getElementById("profesional-nombre").value.trim();
      const pMat = document
        .getElementById("profesional-matricula")
        .value.trim();
      const guardarBtn = document.getElementById("guardar-seguimiento-btn");

      if (!pNom || !pMat)
        return showModalMessage(
          "Por favor, complete los datos del profesional.",
          true,
        );

      // 1. Deshabilitar botón para evitar doble envío
      guardarBtn.disabled = true;
      guardarBtn.classList.add("opacity-50", "cursor-not-allowed");
      guardarBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-3"></i> Guardando...';

      const payload = {
        fecha: document.getElementById("seguimiento-fecha").value,
        profesional: { nombre: pNom, matricula: pMat },
        paciente: {
          dni: afiliadosDniEl.textContent,
          nombre: afiliadosNombreEl.textContent,
        },
        observacionProfesional: document
          .getElementById("observacion-profesional")
          .value.trim(),
        evaluaciones: [],
      };

      document.querySelectorAll(".evaluacion-item").forEach((el) => {
        const titulo =
          el.querySelector(".evaluacion-motivo").dataset.motivoOriginal;
        const id = cleanId(titulo);
        const cal = el.querySelector(`input[name="cal-${id}"]:checked`);
        const obs = el.querySelector(`#obs-${id}`).value.trim();
        if (cal || obs)
          payload.evaluaciones.push({
            motivo: titulo,
            calificacion: cal?.value || "",
            observaciones: obs || "",
          });
      });

      try {
        const res = await fetch("/api/seguimiento/guardar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();

        if (json.success) {
          // 2. Mensaje Éxito -> Al dar Aceptar se abre el resumen
          showModalMessage("✅ Informe guardado correctamente.", false, () => {
            // Limpiar Formulario
            document.getElementById("observacion-profesional").value = "";
            document
              .querySelectorAll("textarea")
              .forEach((t) => (t.value = ""));
            // Resetear Radios a "Bueno" (Opcional, o dejarlos como están)
            document
              .querySelectorAll('input[type="radio"][value="Bueno"]')
              .forEach((r) => (r.checked = true));

            // Abrir Resumen
            abrirModalResumen(payload);
            cargarHistorial(currentPatient.DNI || currentPatient.Documento);

            // Reactivar botón
            guardarBtn.disabled = false;
            guardarBtn.classList.remove("opacity-50", "cursor-not-allowed");
            guardarBtn.innerHTML =
              '<i class="fas fa-save mr-3"></i> Guardar Informe';
          });
        } else {
          showModalMessage("Error servidor: " + json.error, true);
          guardarBtn.disabled = false;
          guardarBtn.classList.remove("opacity-50", "cursor-not-allowed");
          guardarBtn.innerHTML =
            '<i class="fas fa-save mr-3"></i> Guardar Informe';
        }
      } catch (e) {
        showModalMessage("Error conexión.", true);
        guardarBtn.disabled = false;
        guardarBtn.classList.remove("opacity-50", "cursor-not-allowed");
        guardarBtn.innerHTML =
          '<i class="fas fa-save mr-3"></i> Guardar Informe';
      }
    });

  document.getElementById("refresh-history-btn").onclick = () =>
    cargarHistorial(currentPatient.DNI || currentPatient.Documento);
  document.getElementById("cancelar-seguimiento-btn").onclick = () => {
    if (confirm("¿Cerrar?")) window.close();
  };
  document.getElementById("signout-btn").onclick = () => {
    if (confirm("¿Salir?")) window.location.href = "/";
  };
});
