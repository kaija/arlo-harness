import '@arlo/agent-runtime';

// Spawned via utilityProcess.fork by main (ADR-0002). Real Orchestrator/Persona
// wiring, MessagePort handshake, and Provider key injection land in T14; this
// entry only proves the utilityProcess boundary builds and starts.
process.parentPort.postMessage({ type: 'agent-host/ready' });
