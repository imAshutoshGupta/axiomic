/** /: the landing page (its sections live in components/landing). */
import { Hero } from "@/components/landing/hero";
import heroStyles from "@/components/landing/hero.module.css";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MotionProvider } from "@/components/landing/motion";
import { DeveloperSection, GetStartedSection, LayersSection, SafetySection, TeamSection } from "@/components/landing/sections";

export default function HomePage() {
  return (
    <MotionProvider className={heroStyles.landing}>
      <div className={heroStyles.glow} aria-hidden="true" />
      <Hero />
      <HowItWorks />
      <DeveloperSection />
      <LayersSection />
      <SafetySection />
      <TeamSection />
      <GetStartedSection />
    </MotionProvider>
  );
}
