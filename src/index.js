import express from "express";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import citasRoutes from "./routes/citas.js";
import servicesRoutes from "./routes/services.js";
import mascotasRoutes from "./routes/mascotas.js";
import usersRoutes from "./routes/users.js";
import especiesRoutes from "./routes/especies.js";
import inventarioRoutes from "./routes/inventario.js";
import diagnosticosRoutes from "./routes/diagnosticos.js";
import tratamientosRoutes from "./routes/tratamientos.js";
import vacunasRoutes from "./routes/vacunas.js";
import facturasRoutes from "./routes/facturas.js";
import notificacionesRoutes from "./routes/notificaciones.js";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    mensaje: "Bienvenido a la API Veterinaria Antioquia",
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/citas", citasRoutes);
app.use("/api/servicios", servicesRoutes);
app.use("/api/mascotas", mascotasRoutes);
app.use("/api/usuarios", usersRoutes);
app.use("/api/especies", especiesRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/diagnosticos", diagnosticosRoutes);
app.use("/api/tratamientos", tratamientosRoutes);
app.use("/api/vacunas", vacunasRoutes);
app.use("/api/facturas", facturasRoutes);
app.use("/api/notificaciones", notificacionesRoutes);
export default app;
