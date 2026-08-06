import Link from "next/link";
import TerminalV6 from "./components/TerminalV6";

export default function Home() {
  return <>
    <TerminalV6 />
    <Link
      href="/audit"
      aria-label="Открыть визуальный аудит сделок"
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 50,
        border: "1px solid #367b68",
        borderRadius: 8,
        background: "#0c211c",
        color: "#72f0c4",
        padding: "10px 14px",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: ".06em",
        textDecoration: "none",
        boxShadow: "0 10px 30px rgba(0,0,0,.28)",
      }}
    >
      АУДИТ СДЕЛОК →
    </Link>
  </>;
}
