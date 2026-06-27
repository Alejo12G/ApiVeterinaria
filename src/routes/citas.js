import express from "express";
import {pool} from "../config/database.js";
import {authenticateToken} from "../middleware/auth.js";

const router=express.Router();
router.use(authenticateToken);


// ==========================================
// ENDPOINTS DEL MÓDULO DE CITAS
// ==========================================


// 4. Obtener la disponibilidad (citas ya ocupadas) de un veterinario en una fecha
router.get("/disponibilidad", async (req, res) => {
  try {
    const { veterinarioId, fecha } = req.query;

    if (!veterinarioId || !fecha) {
      return res
        .status(400)
        .json({
          error: "Faltan parámetros: veterinarioId y fecha son obligatorios",
        });
    }

    // Buscamos las citas programadas o confirmadas de ese veterinario en esa fecha específica
    const [citasOcupadas] = await pool.execute(
      `SELECT fecha as inicio, duracion_minutos 
       FROM citas 
       WHERE id_veterinario = ? 
       AND DATE(fecha) = ? 
       AND estado IN ('programada', 'confirmada')`,
      [veterinarioId, fecha],
    );

    // Mapeamos para calcular el fin de cada cita sumando los minutos a la fecha de inicio
    const disponibilidad = citasOcupadas.map((cita) => {
      const fechaInicio = new Date(cita.inicio);
      const fechaFin = new Date(
        fechaInicio.getTime() + cita.duracion_minutos * 60000,
      ); // 60000 ms = 1 min

      return {
        inicio: fechaInicio.toISOString(),
        fin: fechaFin.toISOString(),
      };
    });

    res.json(disponibilidad);
  } catch (error) {
    console.error("Error al consultar disponibilidad:", error);
    res
      .status(500)
      .json({ error: "Error al consultar la agenda del veterinario" });
  }
});

// 5. Crear una nueva cita
router.post("/", async (req, res) => {
  try {
    var {idMascota} = req.body;
    const {
      idVeterinario,
      idServicio,
      fecha,
      motivo,
      duracionMinutos,
    } = req.body;
    console.log(fecha)
    const idUsuario = req.user.id;
    console.log(req.body)
    // Validación básica
    if (!idVeterinario || !idServicio || !fecha || !duracionMinutos) {
      console.log(idVeterinario,idServicio,fecha,duracionMinutos)
      console.log("ENTRA 1")
      return res
        .status(400)
        .json({ error: "Faltan datos obligatorios para agendar la cita" });
    }
    
    if (idMascota != null) {
      // Seguridad: Verificar que la mascota pertenece al usuario logueado
      const [mascotas] = await pool.execute(
        `SELECT id FROM mascotas WHERE id = ? AND id_usuario = ?`,
        [idMascota, idUsuario],
      );

      if (mascotas.length === 0) {
        console.log("ENTRA 2")
        return res
          .status(403)
          .json({
            error: "No tienes permiso para agendar citas para esta mascota",
          });
      }
      
    }

    // Insertar la cita asignando el estado 'programada' por defecto
    const fechaObj = new Date(fecha);
    const [result] = await pool.execute(
      `INSERT INTO citas (id_mascota,id_usuario, id_veterinario, id_servicio, fecha, estado, motivo, duracion_minutos) 
       VALUES (?, ?,?, ?, ?, 'programada', ?, ?)`,
      [
        idMascota||null,
        idUsuario,
        idVeterinario,
        idServicio,
        fechaObj,
        motivo || null,
        duracionMinutos,
      ],
    );
console.log("ENTRA 3")
    res.status(201).json({
      id: result.insertId,
      fecha: fecha,
      estado: "programada",
    });
  } catch (error) {
    console.log("ENTRA 4")
    console.error("Error al crear cita:", error);
    res.status(500).json({ error: "Error al agendar la cita" });
  }
});
// ═══════════════════════════════════════════════════════════
//  GET /api/citas/mias
// ═══════════════════════════════════════════════════════════
router.get("/mias", async (req, res) => {
  try {
    const idUsuario = req.user.id;

    const sqlQuery = `
      SELECT 
        c.id, 
        DATE_FORMAT(c.fecha, '%Y-%m-%dT%H:%i:%s') AS fecha, 
        c.estado, 
        c.motivo, 
        c.duracion_minutos AS duracionMinutos,
        s.nombre AS servicioNombre, 
        s.categoria AS servicioCategoria, 
        s.precio_base AS servicioPrecioBase,
        u_vet.nombre AS veterinarioNombre,
        m.nombre AS mascotaNombre, 
        m.foto_url AS mascotaFotoUrl
      FROM citas c
      INNER JOIN servicios s ON c.id_servicio = s.id
      INNER JOIN usuarios u_vet ON c.id_veterinario = u_vet.id 
      LEFT JOIN mascotas m ON c.id_mascota = m.id
      -- Filtramos directamente por el dueño de la cita
      WHERE c.id_usuario = ?
      ORDER BY c.fecha DESC
    `;

    const [citas] = await pool.execute(sqlQuery, [idUsuario]);

    const citasFormateadas = citas.map(cita => ({
      ...cita,
      servicioPrecioBase: parseFloat(cita.servicioPrecioBase)
    }));

    res.json(citasFormateadas);

  } catch (error) {
    console.error("Error al obtener las citas del usuario:", error);
    res.status(500).json({ error: "Error interno del servidor al obtener las citas" });
  }
});
// ═══════════════════════════════════════════════════════════
//  PATCH /api/citas/:id/cancelar
// ═══════════════════════════════════════════════════════════
router.patch("/:id/cancelar", async (req, res) => {
  try {
    const citaId = req.params.id;
    const idUsuario = req.user.id;
    const { motivo } = req.body; // El nuevo motivo (opcional)
    console.log(citaId, motivo)

    // 1. Buscar la cita y obtener el dueño de la mascota asociada
    const buscarQuery = `
      SELECT id,id_usuario,estado 
      FROM citas
      WHERE id = ?
    `;
    const [citas] = await pool.execute(buscarQuery, [citaId]);
    console.log(citas)
    // Validación 404: La cita no existe
    if (citas.length === 0) {
      return res.status(404).json({ error: "La cita solicitada no existe." });
    }

    const cita = citas[0];

    // Validación 403: La cita existe, pero no es de este usuario
    if (cita.id_usuario !== idUsuario) {
      return res.status(403).json({ error: "Acceso denegado: Esta cita pertenece a otro usuario." });
    }

    // Validación 400: El estado no permite cancelación
    if (cita.estado !== 'programada' && cita.estado !== 'confirmada') {
      return res.status(400).json({ 
        error: `No se puede cancelar la cita porque su estado actual es '${cita.estado}'.` 
      });
    }

    // 2. Si pasó todas las validaciones, procedemos a actualizar
    if (motivo) {
      // Si el cliente envió un motivo, lo sobreescribimos/guardamos
      await pool.execute(
        `UPDATE citas SET estado = 'cancelada', motivo = ? WHERE id = ?`,
        [motivo, citaId]
      );
    } else {
      // Si el motivo viene null o indefinido, solo cambiamos el estado
      await pool.execute(
        `UPDATE citas SET estado = 'cancelada' WHERE id = ?`,
        [citaId]
      );
    }

    // 3. Respuesta de éxito (200 OK)
    res.json({ 
      mensaje: "Cita cancelada correctamente.",
      estado: "cancelada"
    });

  } catch (error) {
    console.error("Error al cancelar la cita:", error);
    res.status(500).json({ error: "Error interno del servidor al procesar la cancelación." });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/citas/asignadas
//  Retorna las citas asignadas al veterinario autenticado.
//  Solo accesible para usuarios con rol 'veterinario' o 'administrador'.
// ═══════════════════════════════════════════════════════════
router.get("/asignadas", async (req, res) => {
  try {
    const idVeterinario = req.user.id;
    const rol = req.user.rol;

    // Validar que el usuario sea staff
    if (rol !== "veterinario" && rol !== "administrador") {
      return res.status(403).json({ error: "Acceso denegado: solo veterinarios pueden ver citas asignadas." });
    }

    const sqlQuery = `
      SELECT 
        c.id, 
        DATE_FORMAT(c.fecha, '%Y-%m-%dT%H:%i:%s') AS fecha, 
        c.estado, 
        c.motivo, 
        c.duracion_minutos AS duracionMinutos,
        s.nombre AS servicioNombre, 
        s.categoria AS servicioCategoria, 
        s.precio_base AS servicioPrecioBase,
        u_cli.nombre AS clienteNombre,
        m.nombre AS mascotaNombre, 
        m.foto_url AS mascotaFotoUrl
      FROM citas c
      INNER JOIN servicios s ON c.id_servicio = s.id
      INNER JOIN usuarios u_cli ON c.id_usuario = u_cli.id
      LEFT JOIN mascotas m ON c.id_mascota = m.id
      WHERE c.id_veterinario = ?
      ORDER BY c.fecha DESC
    `;

    const [citas] = await pool.execute(sqlQuery, [idVeterinario]);

    const citasFormateadas = citas.map(cita => ({
      ...cita,
      servicioPrecioBase: parseFloat(cita.servicioPrecioBase)
    }));

    res.json(citasFormateadas);

  } catch (error) {
    console.error("Error al obtener citas asignadas:", error);
    res.status(500).json({ error: "Error interno del servidor al obtener las citas asignadas" });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/citas/:id/detalle
//  Retorna la información completa de una cita con todos
//  los datos relacionados (servicio, cliente, mascota, especie).
//  Solo accesible por el veterinario asignado o un admin.
// ═══════════════════════════════════════════════════════════
router.get("/:id/detalle", async (req, res) => {
  try {
    const citaId = req.params.id;
    const userId = req.user.id;
    const rol = req.user.rol;

    const sqlQuery = `
      SELECT 
        c.id, 
        DATE_FORMAT(c.fecha, '%Y-%m-%dT%H:%i:%s') AS fecha, 
        c.estado, 
        c.motivo, 
        c.duracion_minutos AS duracionMinutos,
        s.nombre AS servicioNombre, 
        s.categoria AS servicioCategoria, 
        s.precio_base AS servicioPrecioBase,
        s.descripcion AS servicioDescripcion,
        s.duracion_estimada_min AS servicioDuracionEstimada,
        u_cli.nombre AS clienteNombre,
        u_cli.email AS clienteEmail,
        u_cli.telefono AS clienteTelefono,
        m.nombre AS mascotaNombre, 
        m.sexo AS mascotaSexo,
        m.esterilizado AS mascotaEsterilizado,
        DATE_FORMAT(m.fecha_nacimiento, '%Y-%m-%d') AS mascotaFechaNacimiento,
        m.foto_url AS mascotaFotoUrl,
        e.nombre_comun AS especieNombre,
        c.id_veterinario AS idVeterinario,
        c.id_usuario AS clienteId
      FROM citas c
      INNER JOIN servicios s ON c.id_servicio = s.id
      INNER JOIN usuarios u_cli ON c.id_usuario = u_cli.id
      LEFT JOIN mascotas m ON c.id_mascota = m.id
      LEFT JOIN especies e ON m.id_especie = e.id
      WHERE c.id = ?
    `;

    const [citas] = await pool.execute(sqlQuery, [citaId]);

    if (citas.length === 0) {
      return res.status(404).json({ error: "La cita no existe." });
    }

    const cita = citas[0];

    // Validar que el usuario sea el veterinario asignado o un admin
    if (rol !== "administrador" && cita.idVeterinario !== userId) {
      return res.status(403).json({ error: "No tienes permiso para ver esta cita." });
    }

    // Limpiar campo interno antes de enviar
    delete cita.idVeterinario;

    cita.servicioPrecioBase = parseFloat(cita.servicioPrecioBase);
    cita.mascotaEsterilizado = cita.mascotaEsterilizado === 1;

    res.json(cita);

  } catch (error) {
    console.error("Error al obtener detalle de cita:", error);
    res.status(500).json({ error: "Error interno del servidor al obtener el detalle de la cita" });
  }
});

// ═══════════════════════════════════════════════════════════
//  PATCH /api/citas/:id/asignar-mascota
//  Asigna una mascota a una cita que fue creada sin mascota.
//  Solo accesible por el veterinario asignado o un admin.
//  Body: { idMascota }
// ═══════════════════════════════════════════════════════════
router.patch("/:id/asignar-mascota", async (req, res) => {
  try {
    const citaId = req.params.id;
    const userId = req.user.id;
    const rol = req.user.rol;
    const { idMascota } = req.body;

    if (!idMascota) {
      return res.status(400).json({ error: "El ID de la mascota es obligatorio." });
    }

    // Obtener la cita
    const [citas] = await pool.execute(
      `SELECT c.id, c.id_veterinario, c.id_mascota, c.id_usuario 
       FROM citas c WHERE c.id = ?`,
      [citaId]
    );

    if (citas.length === 0) {
      return res.status(404).json({ error: "La cita no existe." });
    }

    const cita = citas[0];

    // Validar permisos: solo el veterinario asignado o un admin
    if (rol !== "administrador" && cita.id_veterinario !== userId) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta cita." });
    }

    // Validar que la cita no tenga mascota ya asignada
    if (cita.id_mascota !== null) {
      return res.status(400).json({ error: "Esta cita ya tiene una mascota asignada." });
    }

    // Validar que la mascota pertenece al dueño de la cita
    const [mascotas] = await pool.execute(
      `SELECT id FROM mascotas WHERE id = ? AND id_usuario = ?`,
      [idMascota, cita.id_usuario]
    );

    if (mascotas.length === 0) {
      return res.status(400).json({ error: "La mascota no pertenece al cliente de esta cita." });
    }

    // Asignar la mascota
    await pool.execute(
      `UPDATE citas SET id_mascota = ? WHERE id = ?`,
      [idMascota, citaId]
    );

    res.json({ mensaje: "Mascota asignada correctamente.", idMascota });

  } catch (error) {
    console.error("Error al asignar mascota:", error);
    res.status(500).json({ error: "Error al asignar la mascota a la cita." });
  }
});

// (La ruta PATCH /:id/completar fue migrada a diagnosticos.js para cumplir con TC-004)
export default router;