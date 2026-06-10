// Modules under test create Supabase clients at import time — give them
// dummy env so imports don't throw. No test makes a real network call.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key'
process.env.WEBHOOK_SECRET ||= 'test-webhook-secret'
process.env.CLIENT_ID ||= 'client_test'
