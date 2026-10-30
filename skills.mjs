// skills.mjs · carga los skills de la carpeta ./skills (cada uno es una carpeta con un SKILL.md)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CARPETA = fileURLToPath(new URL("./skills", import.meta.url));

// Separa el encabezado (entre líneas "---") del cuerpo del archivo.
function leerEncabezado(texto) {
  const t = texto.replace(/\r\n/g, "\n"); // los archivos de Windows traen \r\n
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linea of m[1].split("\n")) {
    const i = linea.indexOf(":");
    if (i > 0) meta[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  return { meta, cuerpo: m[2].trim() };
}

// Devuelve un Map nombre -> { nombre, descripcion, instrucciones }.
export function cargarSkills(carpeta = CARPETA) {
  const skills = new Map();
  if (!existsSync(carpeta)) return skills;
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const archivo = join(carpeta, entrada.name, "SKILL.md");
    if (!existsSync(archivo)) continue;
    const leido = leerEncabezado(readFileSync(archivo, "utf8"));
    if (!leido || !leido.meta.description) {
      console.warn(`  (skill ignorado: ${entrada.name}/SKILL.md necesita un encabezado con description)`);
      continue;
    }
    const nombre = leido.meta.name || entrada.name;
    skills.set(nombre, { nombre, descripcion: leido.meta.description, instrucciones: leido.cuerpo });
  }
  return skills;
}

// Texto para las instrucciones del modelo: SOLO nombre y descripción de cada skill.
// El contenido completo se carga bajo demanda con la herramienta leer_skill.
export function catalogoParaPrompt(skills) {
  if (skills.size === 0) return undefined;
  const lista = [...skills.values()].map((s) => `- ${s.nombre}: ${s.descripcion}`).join("\n");
  return (
    "Tienes acceso a skills: guías de procedimiento para tareas concretas.\n" +
    "Antes de actuar, revisa si alguna aplica a lo que pide el usuario. " +
    "Si aplica, llama primero a la herramienta leer_skill con su nombre y sigue sus instrucciones.\n\n" +
    `Skills disponibles:\n${lista}`
  );
}

// Implementación de la herramienta leer_skill. Busca por nombre en el catálogo
// (nunca arma rutas con lo que envía el modelo).
export function leerSkill(skills, nombre) {
  const skill = skills.get(nombre);
  if (!skill) {
    const disponibles = [...skills.keys()].join(", ") || "ninguno";
    throw new Error(`No existe el skill "${nombre}". Disponibles: ${disponibles}`);
  }
  return { skill: skill.nombre, instrucciones: skill.instrucciones };
}
