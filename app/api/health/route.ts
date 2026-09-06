export function GET() {
  // Process readiness only: deliberately does not pretend to test the exchange.
  return Response.json({ status: "ok", service: "pattern-forge" });
}
