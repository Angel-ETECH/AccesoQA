import { openDatabase } from "./database.js";

const db = openDatabase();
db.close();
console.log("Base de datos de AccesoQA inicializada correctamente.");
