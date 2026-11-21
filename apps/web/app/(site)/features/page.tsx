import { permanentRedirect } from "next/navigation";

/** /features was merged into /product (DECISIONS #81). Old links still work. */
export default function FeaturesPage() {
  permanentRedirect("/product#features");
}
