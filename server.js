// server.js (proxy Postimages mejorado)
import express from "express";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import fs from "fs";
import cors from "cors";

const app = express();
app.use(cors());
const upload = multer({ dest: "tmp/" });

async function fetchHtml(url) {
  const r = await axios.get(url, { headers: { "User-Agent": "node-postimages-proxy/1.0" } });
  return r.data;
}

// Extrae URL de imagen de HTML devuelto por postimages.org
function extractImageUrlFromHtml(html) {
  // 1) i.postimg.cc (direct image)
  let m = html.match(/https?:\/\/i\.postimg\.cc\/[^\s"'<>)]+/i);
  if (m) return m[0];

  // 2) sNN.postimg.org
  m = html.match(/https?:\/\/s\d+\.postimg\.org\/[^\s"'<>)]+/i);
  if (m) return m[0];

  // 3) postimg.cc (page link)
  m = html.match(/https?:\/\/postimg\.cc\/[^\s"'<>)]+/i);
  if (m) return m[0];

  // 4) og:image (fallback)
  m = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
  if (m) return m[1];

  return null;
}

app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });

  try {
    // Construir form-data como formulario de postimages
    const fd = new FormData();
    // Campo 'upload[]' es compatible con la interfaz del sitio
    fd.append("upload[]", fs.createReadStream(req.file.path), req.file.originalname);
    fd.append("adult", "no");

    // Enviar a postimages.org
    const response = await axios.post("https://postimages.org/", fd, {
      headers: { ...fd.getHeaders(), "User-Agent": "node-postimages-proxy/1.0" },
      maxBodyLength: Infinity
    });

    const html = response.data;
    // intenta extraer url directa
    let url = extractImageUrlFromHtml(html);

    // si obtenemos un page link (postimg.cc/...), fetchear la página y buscar og:image / i.postimg.cc
    if (url && url.includes("postimg.cc")) {
      try {
        const pageHtml = await fetchHtml(url);
        const fromPage = extractImageUrlFromHtml(pageHtml);
        if (fromPage) url = fromPage;
      } catch (e) {
        console.warn("No se pudo fetchear page link:", e.message || e);
      }
    }

    // limpiar tmp
    fs.unlink(req.file.path, () => {});

    if (!url) {
      console.error("No se pudo extraer URL de la respuesta de Postimages.");
      // Para debugging, devolver parte del HTML (¡solo para local/testing!)
      return res.status(500).json({ error: "No se pudo extraer URL", debugSample: html.slice(0, 800) });
    }

    console.log("Upload -> URL extraída:", url);
    return res.json({ url });
  } catch (err) {
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    console.error("Error proxy:", err?.response?.status, err?.response?.data || err.message || err);
    return res.status(500).json({ error: "Error subiendo a Postimages", detail: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy Postimages escuchando en http://localhost:${PORT}`));
