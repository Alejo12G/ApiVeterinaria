import express from "express";
import {pool} from "../config/database.js";
import {authenticateToken} from "../middleware/auth.js";

const router=express.Router();
router.use(authenticateToken);
router.get("/", async (req, res) => {
  try {
    const [servicios] = await pool.execute(
      `SELECT id, nombre, descripcion, categoria, precio_base as precioBase, duracion_estimada_min as duracionEstimadaMin, activo 
       FROM servicios 
       WHERE activo = 1`,
    );

    res.json(servicios);
  } catch (error) {
    console.error("Error al obtener servicios:", error);
    res.status(500).json({ error: "Error al obtener los servicios" });
  }
});

export default router;