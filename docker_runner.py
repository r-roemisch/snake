import subprocess
import os

class DockerSandbox:
    def __init__(self, image_name="snake_factory_sandbox"):
        self.image_name = image_name
        self.workspace_dir = os.path.abspath("./src")
        
    def build_image(self):
        """Builds the Docker image locally if it doesn't exist."""
        print("[Docker] Building execution sandbox image...")
        cmd = ["docker", "build", "-t", self.image_name, "."]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Failed to build Docker image: {result.stderr}")
        print("[Docker] Sandbox image ready.")

    def run_script(self, script_relative_path: str, timeout_seconds=10) -> dict:
        """
        Executes a Python script inside the isolated Docker container.
        """
        # Command mounts local ./src to /workspace inside container
        cmd = [
            "docker", "run", "--rm",
            "--network", "none",  # Blocks outgoing internet access from executed code
            "-v", f"{self.workspace_dir}:/workspace",
            self.image_name,
            "python", script_relative_path
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Execution timed out after {timeout_seconds} seconds.",
                "exit_code": -1
            }