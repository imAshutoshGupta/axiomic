import { LAYERS } from "@axiomic/shared";

export default function HomePage() {
  return (
    <main>
      <h1>axiomic</h1>
      <p>A private, team-controlled home for AI rule files.</p>
      <p>Rule layers: {LAYERS.join(" → ")}</p>
    </main>
  );
}
