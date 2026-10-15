/**
 * Loads what the built-in plugins register for each other (extension points, see lib/plugin-kit):
 * every plugin's `server.ts`, listed in server.generated.ts by `npm run plugins:index`. Import this
 * where a point is read, so the contributions are in. Server only.
 */
import "./server.generated";
