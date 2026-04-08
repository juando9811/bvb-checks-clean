const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ================= ENV =================
const SLACK_TOKEN = process.env.TOKEN;
const CHANNEL = process.env.CHANNEL;

// ================= FIREBASE (SECRET FILE) =================
const serviceAccount = require("/etc/secrets/bvb-checks.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ================= HORARIOS =================
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// ================= GENERAR BLOQUES =================
function generarBlocks(estados) {
  let blocks = [];

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "📋 *BVB Checks del día*",
    },
  });

  for (let horario of horarios) {
    const slot = estados[horario] || {};

    let text = `🕐 *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by @${slot.takenBy}\n`;
      if (slot.doneBy) {
        text += `✅ Done by @${slot.doneBy}`;
      }
    }

    let elements = [];

    if (!slot.takenBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        action_id: `take_${horario}`,
      });
    }

    if (slot.takenBy && !slot.doneBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
        action_id: `done_${horario}`,
      });
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    if (elements.length > 0) {
      blocks.push({
        type: "actions",
        elements,
      });
    }
  }

  return blocks;
}

// ================= MENSAJE DIARIO =================
app.get("/send", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const ref = db.collection("bvb-checks").doc(today);
  const doc = await ref.get();

  let data = doc.exists ? doc.data() : {};

  if (!doc.exists) {
    await ref.set({});
  }

  const blocks = generarBlocks(data);

  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: "BVB Checks del día",
      blocks,
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  res.send(response.data);
});

// ================= INTERACCIONES =================
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  const action = payload.actions[0];
  const user = payload.user.username;
  const horario = action.action_id.replace("take_", "").replace("done_", "");

  const today = new Date().toISOString().split("T")[0];
  const ref = db.collection("bvb-checks").doc(today);

  const doc = await ref.get();
  let data = doc.data() || {};

  if (!data[horario]) data[horario] = {};

  if (action.action_id.startsWith("take_")) {
    if (!data[horario].takenBy) {
      data[horario].takenBy = user;
    }
  }

  if (action.action_id.startsWith("done_")) {
    data[horario].doneBy = user;
  }

  await ref.set(data);

  await axios.post(
    "https://slack.com/api/chat.update",
    {
      channel: CHANNEL,
      ts: payload.message.ts,
      text: "BVB Checks del día",
      blocks: generarBlocks(data),
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  res.sendStatus(200);
});

// ================= SERVER =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server corriendo en", PORT);
});