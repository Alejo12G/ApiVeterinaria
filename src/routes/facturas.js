import express from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { crearNotificacion } from "./diagnosticos.js";

const router = express.Router();
router.use(authenticateToken);

function soloStaff(req, res, next) {
  const rol = req.user?.rol;
  if (rol !== "veterinario" && rol !== "administrador")
    return res.status(403).json({ error: "Acceso denegado." });
  next();
}

function soloAdmin(req, res, next) {
  if (req.user?.rol !== "administrador")
    return res.status(403).json({ error: "Solo administradores." });
  next();
}

// ═══════════════════════════════════════════════════════════════
//  POST /api/facturas
//  Genera factura para una cita completada calculando subtotal.
//  Body: { idCita }
//  Acceso: solo administrador
// ═══════════════════════════════════════════════════════════════
router.post("/", soloAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { idCita } = req.body;

    if (!idCita) {
      conn.release();
      return res.status(400).json({ error: "Falta idCita." });
    }

    // Obtener cita y servicio
    const [citas] = await conn.execute(
      `SELECT c.id_usuario, c.estado, s.precio_base, s.nombre AS servicioNombre
       FROM citas c
       INNER JOIN servicios s ON c.id_servicio = s.id
       WHERE c.id = ?`,
      [idCita]
    );

    if (citas.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Cita no encontrada." });
    }

    const cita = citas[0];
    if (cita.estado !== "completada") {
      conn.release();
      return res.status(400).json({ error: "La cita debe estar completada para facturar." });
    }

    // Validar que no exista factura previa
    const [prev] = await conn.execute(`SELECT id FROM facturas WHERE id_cita = ?`, [idCita]);
    if (prev.length > 0) {
      conn.release();
      return res.status(409).json({ error: "La cita ya tiene una factura." });
    }

    await conn.beginTransaction();

    let subtotal = parseFloat(cita.precio_base);
    const detalles = [];
    
    // Detalle 1: El servicio de la consulta
    detalles.push({
      descripcion: `Servicio: ${cita.servicioNombre}`,
      cantidad: 1,
      precioUnitario: parseFloat(cita.precio_base),
      subtotal: parseFloat(cita.precio_base)
    });

    // Detalle 2..N: Medicamentos recetados (buscamos en tratamientos)
    const [tratamientos] = await conn.execute(
      `SELECT t.id, m.nombre, m.precio, t.dosis, t.duracion_dias
       FROM tratamientos t
       INNER JOIN diagnosticos d ON d.id = t.id_diagnostico
       INNER JOIN medicamentos m ON m.id = t.id_medicamento
       WHERE d.id_cita = ?`,
      [idCita]
    );

    for (const t of tratamientos) {
      // Cálculo simplificado: asumimos 1 unidad de venta por tratamiento 
      // (o calcular basado en dosis/frecuencia si es necesario, aquí lo haremos por 1 unidad de precio base)
      const cant = 1;
      const p = parseFloat(t.precio);
      subtotal += (cant * p);
      detalles.push({
        descripcion: `Medicamento: ${t.nombre} (Trat. #${t.id})`,
        cantidad: cant,
        precioUnitario: p,
        subtotal: cant * p
      });
    }

    // Impuestos fijos para simplificar (19% IVA)
    const impuestos = subtotal * 0.19;
    const total = subtotal + impuestos;

    // Crear Factura
    const [facRes] = await conn.execute(
      `INSERT INTO facturas (id_cita, id_usuario, total, estado, fecha_emision)
       VALUES (?, ?, ?, 'pendiente', NOW())`,
      [idCita, cita.id_usuario, total]
    );
    const idFactura = facRes.insertId;

    // Insertar Detalles
    for (const d of detalles) {
      await conn.execute(
        `INSERT INTO factura_detalles (id_factura, descripcion, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [idFactura, d.descripcion, d.cantidad, d.precioUnitario, d.subtotal]
      );
    }

    await conn.commit();
    conn.release();

    try {
      await crearNotificacion({
        idUsuario: cita.id_usuario,
        tipo: "factura",
        titulo: "Nueva factura generada",
        mensaje: `Se ha generado una factura por $${total.toLocaleString("es-CO")} para tu cita #${idCita}.`,
      });
    } catch (e) {}

    res.status(201).json({
      id: idFactura,
      subtotal,
      impuestos,
      total,
      estado: "pendiente",
      detalles
    });

  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error("[facturas.POST] Error:", error);
    res.status(500).json({ error: "Error al generar la factura." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  PATCH /api/facturas/:id/pagar
//  Registra pago. Fix TC-009: usa UTC para zona horaria.
//  Acceso: solo administrador
// ═══════════════════════════════════════════════════════════════
router.patch("/:id/pagar", soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { metodoPago } = req.body;

    if (!metodoPago) return res.status(400).json({ error: "Falta metodoPago." });

    const [facs] = await pool.execute(`SELECT estado, total FROM facturas WHERE id = ?`, [id]);
    if (facs.length === 0) return res.status(404).json({ error: "Factura no encontrada." });

    if (facs[0].estado === "pagada") {
      return res.status(400).json({ error: "La factura ya está pagada." });
    }

    // Fix TC-009: usar UTC y MySQL lo manejará si usamos función UTC_TIMESTAMP()
    await pool.execute(
      `UPDATE facturas 
       SET estado = 'pagada', metodo_pago = ?, fecha_pago = UTC_TIMESTAMP()
       WHERE id = ?`,
      [metodoPago, id]
    );

    res.json({ mensaje: "Factura pagada correctamente.", id, estado: "pagada" });
  } catch (error) {
    console.error("[facturas.PATCH pagar] Error:", error);
    res.status(500).json({ error: "Error al registrar el pago." });
  }
});

export default router;
