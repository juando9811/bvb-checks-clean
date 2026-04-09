const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CHANNEL = process.env.CHANNEL;
const SLACK_TOKEN = process.env.TOKEN;

// 🔥 FIREBASE
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/bvb-checks.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 🕒 HORARIOS
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// 📦 GENERAR BLOQUES (FIX FINAL)
function generarBlocks(data) {
  return horarios.flatMap((hora) => {
    const item = data[hora] || {};

    let texto = `⏰ *${hora}*\n`;

    if (item.takenBy) {
      texto += `🟢 Taken by <@${item.takenBy}>\n`;
    } else {
      texto += `_Disponible_\n`;
    }

    if (item.doneBy) {
      texto += `✅ Done by <@${item.doneBy}>\n`;
    }

    let elements = [];

    if (!item.takenBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        action_id: `take_${hora}`,
        style: "primary",
      });
    } else if (!item.doneBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
        action_id: `done_${hora}`,
        style: "danger",
      });
    }

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: texto,
        },
      },
      ...(elements.length > 0
        ? [
            {
              type: "actions",
              elements: elements,
            },
          ]
        : []),
      { type: "divider" },
    ];
  });
}

// 🚀 ENVIAR MENSAJE
async function enviarMensaje() {
  try {
    const hoy = new Date().toISOString().split("T")[0];

    const ref = db.collection("bvb-checks").doc(hoy);
    const doc = await ref.get();

    if (!doc.exists) {
      const base = {};
      horarios.forEach((h) => (base[h] = {}));
      await ref.set(base);
    }

    const data = (await ref.get()).data();

    // 🧵 MENSAJE PRINCIPAL
    const res = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        text: "📋 BVB Checks del día",
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.data.ok) {
      console.error("❌ Slack error:", res.data);
      return;
    }

    const thread_ts = res.data.ts;

    // 🧵 THREAD CON HORARIOS
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        thread_ts: thread_ts,
        text: "Horarios del día",
        blocks: generarBlocks(data),
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Mensaje enviado correctamente");
  } catch (err) {
    console.error("🔥 ERROR:", err.message);
  }
}

// ⏰ CRON COLOMBIA
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("⏰ Ejecutando envío diario...");
    enviarMensaje();
  },
  {
    timezone: "America/Bogota",
  }
);

// 🔥 INTERACCIONES (SIN DELAY)
app.post("/slack/interactions", (req, res) => {
  res.status(200).send(); // ⚡ respuesta inmediata

  setImmediate(async () => {
    try {
      const payload = JSON.parse(req.body.payload);
      const action = payload.actions[0];
      const user = payload.user.id;

      const hoy = new Date().toISOString().split("T")[0];
      const ref = db.collection("bvb-checks").doc(hoy);
      const doc = await ref.get();
      const data = doc.data();

      const horario = action.action_id
        .replace("take_", "")
        .replace("done_", "");

      if (action.action_id.startsWith("take_")) {
        if (!data[horario].takenBy) {
          data[horario].takenBy = user;
        }
      }

      if (action.action_id.startsWith("done_")) {
        data[horario].doneBy = user;
      }

      await ref.set(data);

      // 🔄 ACTUALIZAR MENSAJE
      await axios.post(
        "https://slack.com/api/chat.update",
        {
          channel: CHANNEL,
          ts: payload.message.ts,
          text: "📋 BVB Checks del día",
          blocks: generarBlocks(data),
        },
        {
          headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      console.error("❌ ERROR:", err.message);
    }
  });
});

// 🧪 TEST MANUAL
app.get("/send-now", async (req, res) => {
  await enviarMensaje();
  res.send("OK");
});

// 🚀 START
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server listo");
});