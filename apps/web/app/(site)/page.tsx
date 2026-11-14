import { Hero } from "../../components/landing/hero";
import heroStyles from "../../components/landing/hero.module.css";
import { HowItWorks } from "../../components/landing/how-it-works";
import { MotionProvider } from "../../components/landing/motion";
import { DeveloperSection, LayersSection, SafetySection, SecuritySection, StatusSection } from "../../components/landing/sections";

export default function HomePage() {
  return (
    <MotionProvider className={heroStyles.landing}>
      <div className={heroStyles.glow} aria-hidden="true" />
      <Hero />
      <HowItWorks />
      <DeveloperSection />
      <LayersSection />
      <SafetySection />
      <SecuritySection />
      <StatusSection />
    </MotionProvider>
  );
}
