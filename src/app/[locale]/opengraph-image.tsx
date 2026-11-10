import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";
import es from "@/messages/es.json";

export const alt = es.Brand.slogan;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Imagen social por defecto. Texto sobre el degradado de marca; cuando llegue el logo
// oficial se reemplaza el wordmark por el SVG de public/brand/.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          background: "linear-gradient(180deg, #0A1240 0%, #17167a 55%, #4b2fc4 100%)",
          color: "#FBF5EA",
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6, color: "#B9A8FF" }}>{es.Brand.name}</div>
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, marginTop: 28, maxWidth: 980 }}>
          {es.Brand.slogan}
        </div>
        <div style={{ fontSize: 30, letterSpacing: 8, marginTop: 36, textTransform: "uppercase", color: "#F5A640" }}>
          {es.Brand.taglineSpaced}
        </div>
      </div>
    ),
    size,
  );
}
