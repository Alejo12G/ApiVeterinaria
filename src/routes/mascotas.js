import express from "express";
import {pool} from "../config/database.js";
import {authenticateToken} from "../middleware/auth.js";

const router=express.Router();
router.use(authenticateToken);
// 1. Obtener las mascotas del usuario autenticado
router.get("/mias", async (req, res) => {
  try {
    const idUsuario = req.user.id;

    const [mascotas] = await pool.execute(
      `SELECT id, nombre, fecha_nacimiento as fechaNacimiento, sexo, esterilizado, id_especie as idEspecie, foto_url as fotoUrl 
       FROM mascotas 
       WHERE id_usuario = ?`,
      [idUsuario],
    );

    res.json(mascotas);
  } catch (error) {
    console.error("Error al obtener mascotas:", error);
    res.status(500).json({ error: "Error al obtener tus mascotas" });
  }
});

export default router;  