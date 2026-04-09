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

// 📦 BLOQUES
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

    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: texto },
      },
      {
        type: "actions",
        elements: [
          !item.takenBy
            ? {
                type: "button",
                text: { type: "plain_text", text: "Take" },
                action_id: `take_${hora}`,
                style: "primary",
              }
            : !item.doneBy
            ? {
                type: "button",
                text: { type: "plain_text", text: "Done" },
                action_id: `done_${hora}`,
                style: "danger",
              }
            : {
                type: "plain_text",
                text: "✔ Completado",
              },
        ],
      },
      { type: "divider" },
    ];
  });
}

// 🚀 ENVÍO
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

    // 🧵 1. MENSAJE PRINCIPAL
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
      console.error("❌ Error Slack main:", res.data);
      return;
    }

    const thread_ts = res.data.ts;

    console.log("✅ thread_ts:", thread_ts);

    // 🧵 2. MENSAJE CON BLOQUES (EL IMPORTANTE)
    const res2 = await axios.post(
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

    if (!res2.data.ok) {
      console.error("❌ Error Slack blocks:", res2.data);
    } else {
      console.log("✅ Thread con bloques enviado");
    }

  } catch (error) {
    console.error("🔥 ERROR GENERAL:", error.message);
  }
}

// ⏰ CRON
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("⏰ Ejecutando...");
    enviarMensaje();
  },
  {
    timezone: "America/Bogota",
  }
);

// 🔥 INTERACCIONES (FIX REAL)
app.post("/slack/interactions", (req, res) => {
  // ✅ RESPUESTA INMEDIATA (CRÍTICO)
  res.status(200).send();

  // 🚀 PROCESO ASYNC
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

      // 🔄 UPDATE
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

// 🧪 TEST
app.get("/send-now", async (req, res) => {
  await enviarMensaje();
  res.send("OK");
});

// START
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server listo");
});