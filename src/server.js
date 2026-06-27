import { config } from "dotenv";
import app from "./index.js";
config();
const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en ${PORT}`);
});
