// agente.mjs  ·  agente con OpenAI  ·  ejecutar con:  node --env-file=.env agente.mjs
// .env necesita:  OPENAI_API_KEY=tu_clave   y   OPENAI_MODEL=nombre_del_modelo
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import readline from "node:readline/promises";
import { cargarSkills, catalogoParaPrompt, leerSkill } from "./skills.mjs";

const apiKey = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey }); // lee la clave de la variable OPENAI_API_KEY
const MODELO = process.env.OPENAI_MODEL; // cópialo de la documentación actual de OpenAI
const MAX_PASOS = 5; // límite de seguridad del ciclo

// SKILLS: guías de procedimiento en ./skills. Al modelo solo se le anuncia nombre y descripción;
// el contenido completo se carga bajo demanda con la herramienta leer_skill.
const skills = cargarSkills();
const INSTRUCCIONES = catalogoParaPrompt(skills);

// 1) HERRAMIENTAS
//    Declaración: lo que ve el modelo (nombre, descripción y esquema de parámetros).
const declaraciones = [
  {
    type: "function",
    name: "obtener_clima",
    description:
      "Devuelve la temperatura actual en grados Celsius de una ciudad. Solo consulta, no modifica nada.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: "Nombre de la ciudad, por ejemplo Quito" },
      },
      required: ["ciudad"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "crear_recordatorio",
    description: "Crea un recordatorio para el usuario. Es una acción que modifica datos.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Texto del recordatorio" },
      },
      required: ["texto"],
      additionalProperties: false,
    },
  },
];

if (skills.size > 0) {
  declaraciones.push({
    type: "function",
    name: "leer_skill",
    description: "Devuelve las instrucciones completas de un skill. Solo consulta, no modifica nada.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre exacto del skill, tal como aparece en la lista" },
      },
      required: ["nombre"],
      additionalProperties: false,
    },
  });
}

//    Implementación: lo que ejecuta TU código (el modelo nunca ejecuta nada).
const herramientas = {
  obtener_clima: async ({ ciudad }) => {
    const datos = { quito: 11, guayaquil: 29, cuenca: 13 }; // datos de ejemplo
    const temp = datos[String(ciudad).toLowerCase()];
    if (temp === undefined) throw new Error(`No tengo datos de "${ciudad}"`);
    return { ciudad, temperatura_c: temp };
  },
  crear_recordatorio: async ({ texto }) => ({ ok: true, creado: texto }),
  leer_skill: async ({ nombre }) => leerSkill(skills, nombre), // solo lectura
};

// Acciones que modifican datos: piden aprobación humana antes de ejecutarse.
const requiereAprobacion = new Set(["crear_recordatorio"]);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function aprobar(nombre, args) {
  const r = await rl.question(
    `\n  ⚠️  El agente quiere ejecutar ${nombre}(${JSON.stringify(args)}). ¿Aprobar? (s/n): `
  );
  return r.trim().toLowerCase() === "s";
}

async function agente(pregunta) {
  // 2) MEMORIA: la lista de elementos que se reenvía al modelo en cada llamada.
  const input = [{ role: "user", content: pregunta }];

  for (let paso = 1; paso <= MAX_PASOS; paso++) {
    // 3) EL MODELO DECIDE: responder o pedir una herramienta.
    const respuesta = await client.responses.create({
      model: MODELO,
      input,
      instructions: INSTRUCCIONES,
      tools: declaraciones,
    });

    // 4) ¿Sin llamadas a herramientas? Entonces es la respuesta final y el ciclo termina.
    const llamadas = respuesta.output.filter((item) => item.type === "function_call");
    if (llamadas.length === 0) return respuesta.output_text;

    // El modelo solo PROPONE. Su salida se guarda en la memoria (el helper la deja lista
    // para reenviarla como entrada).
    input.push(...toResponseInputItems(respuesta.output));

    // 5) TU CÓDIGO EJECUTA, y decide si se permite.
    for (const llamada of llamadas) {
      const { name, call_id } = llamada;
      let resultado;
      try {
        const args = JSON.parse(llamada.arguments); // los argumentos llegan como TEXTO JSON
        console.log(`  paso ${paso}: el modelo pide ${name}(${JSON.stringify(args)})`);
        if (!herramientas[name]) throw new Error(`Herramienta desconocida: ${name}`);
        if (requiereAprobacion.has(name) && !(await aprobar(name, args))) {
          resultado = { error: "El usuario rechazó esta acción." };
        } else {
          resultado = await herramientas[name](args);
        }
      } catch (e) {
        resultado = { error: e.message }; // el fallo vuelve al modelo, que puede replanificar
      }

      // 6) EL RESULTADO VUELVE como un elemento 'function_call_output', enlazado con
      //    la llamada por su call_id (aquí no es un mensaje con rol "user").
      input.push({
        type: "function_call_output",
        call_id,
        output: JSON.stringify(resultado), // la salida debe ser texto
      });
    }
  }

  return "Me detuve: alcancé el máximo de pasos sin terminar.";
}

const pregunta =
  "¿Qué temperatura hay en Quito? Si hace menos de 15 grados, créame un recordatorio para llevar abrigo.";
console.log("Pregunta:", pregunta, "\n");
console.log("\nRespuesta final:", await agente(pregunta));
rl.close();
