// Main app shell — two modes: "Find the Spot" and "Evaluate a Spot"

export default function Home() {
  // TODO: Mode toggle between "Find the Spot" (optimizer flow) and "Evaluate a Spot" (single-point analysis)
  // TODO: Render PersonInput list, ObjectiveSlider, DepartureTimePicker, Map, and results
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">meetmidpoint</h1>
      <p className="mt-4 text-lg text-zinc-500">Find the fairest meeting spot for everyone.</p>
    </main>
  );
}
