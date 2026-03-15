import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell">
      <h1 className="hero-title">ESP32 Test Lab</h1>
      <p className="hero-subtitle">
        This workspace contains a minimal compile and flash flow for ESP32.
      </p>
      <section className="surface">
        <p>Open the dedicated test page to compile Arduino code and flash ESP32 via Web Serial.</p>
        <p>
          <Link href="/esp32-test">Go to /esp32-test</Link>
        </p>
      </section>
    </main>
  );
}
