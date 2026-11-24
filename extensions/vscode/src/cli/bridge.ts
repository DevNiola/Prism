import { execFile } from "child_process";

export function callGrat(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("prism", [...args, "--output", "json"], (error, stdout, stderr) => {
      if (error) {
        const stderrMsg = stderr ? stderr.trim() : "";
        const message = stderrMsg
          ? "Prism CLI error: " + stderrMsg
          : "Prism CLI failed: " + (error.message || "Unknown error");
        return reject(new Error(message));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        const stderrMsg = stderr ? stderr.trim() : "";
        const message = stderrMsg
          ? "Failed to parse Prism output: " + stderrMsg
          : "Failed to parse Prism output";
        reject(new Error(message));
      }
    });
  });
}
