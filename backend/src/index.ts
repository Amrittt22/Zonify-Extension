import "dotenv/config";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

// Fail fast if the environment is invalid (e.g. missing ANTHROPIC_API_KEY
// while MOCK_LLM is not enabled).
const config = getConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(
    `[zonify] listening on port ${config.port} (mock=${config.mockLlm}, model=${config.model})`,
  );
});
