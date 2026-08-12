import os
import json
from datetime import datetime
from audit_logger import AuditLogger
from agent import OpenRouterAgent
from docker_runner import DockerSandbox

MAX_RETRIES = 3  # Safeguard against API billing loops

class Orchestrator:
    def __init__(self):
        self.audit = AuditLogger()
        self.record_file = "factory_record.json"
        self.memory_file = "memory/SNAKE-101.md"
        self.agent = OpenRouterAgent(agent_name="snake_developer_agent")
        self.sandbox = DockerSandbox()
        
        # Build Docker sandbox on startup
        self.sandbox.build_image()

    def read_file(self, path: str) -> str:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        return ""

    def append_file(self, path: str, content: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(content)

    def write_file(self, path: str, content: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def execute_next_task(self):
        with open(self.record_file, "r", encoding="utf-8") as f:
            record = json.load(f)

        tasks = record.get("tasks", [])
        pending_tasks = [t for t in tasks if t["status"] == "PENDING"]

        if not pending_tasks:
            self.audit.log("orchestrator", "FACTORY_COMPLETE", {"message": "All tasks are finished!"})
            print("\n[Factory] All tasks completed!")
            return False

        current_task = pending_tasks[0]
        task_id = current_task["id"]
        retries = current_task.get("retries", 0)

        # Safeguard: Circuit breaker for infinite loops
        if retries >= MAX_RETRIES:
            self.audit.log("orchestrator", "TASK_FAILED_MAX_RETRIES", {"task_id": task_id})
            print(f"\n[Factory] Task {task_id} failed after {MAX_RETRIES} attempts. Stopping factory.")
            return False

        self.audit.log("orchestrator", "TASK_START", {"task_id": task_id, "attempt": retries + 1})
        print(f"\n[Factory] Executing {task_id} (Attempt {retries + 1})...")

        # Gather Context
        memory_content = self.read_file(self.memory_file)
        skill_content = self.read_file(current_task["skill_required"])

        combined_prompt = f"""
=== DOMAIN SKILL RULES ===
{skill_content}

=== PROJECT MEMORY CONTEXT ===
{memory_content}

=== CURRENT TASK INSTRUCTION ===
Task ID: {task_id}
Target File: {current_task['target_file']}
Instruction: {current_task['instruction']}

Return ONLY valid executable Python code for {current_task['target_file']}.
"""

        # Call OpenRouter Agent
        self.audit.log("orchestrator", "CALLING_AGENT", {"task_id": task_id})
        generated_code = self.agent.run_task(combined_prompt)

        # Save generated code to ./src
        target_file = current_task["target_file"]
        self.write_file(target_file, generated_code)
        self.audit.log("orchestrator", "FILE_WRITTEN", {"file": target_file})

        # Run Verification inside Docker Sandbox
        relative_script_name = os.path.basename(target_file)
        self.audit.log("orchestrator", "DOCKER_VERIFICATION_START", {"script": relative_script_name})
        
        sandbox_result = self.sandbox.run_script(relative_script_name)

        if sandbox_result["success"]:
            self.audit.log("orchestrator", "DOCKER_VERIFICATION_SUCCESS", {"stdout": sandbox_result["stdout"]})
            
            # Update memory
            memory_update = f"\n- [{datetime.now().isoformat()}] Completed {task_id}. Written and verified `{target_file}` via Docker sandbox."
            self.append_file(self.memory_file, memory_update)

            # Mark task complete
            current_task["status"] = "COMPLETED"
            with open(self.record_file, "w", encoding="utf-8") as f:
                json.dump(record, f, indent=2)

            self.audit.log("orchestrator", "TASK_COMPLETE", {"task_id": task_id})
            return True
        else:
            # Code failed inside Docker
            current_task["retries"] = retries + 1
            with open(self.record_file, "w", encoding="utf-8") as f:
                json.dump(record, f, indent=2)

            self.audit.log("orchestrator", "DOCKER_VERIFICATION_FAILED", {
                "stderr": sandbox_result["stderr"],
                "retry": retries + 1
            })
            print(f"[Factory] Code execution failed in Docker sandbox:\n{sandbox_result['stderr']}")
            return True

    def run_all(self):
        self.audit.log("orchestrator", "FACTORY_START", {"project": "Nokia Snake Game (Dockerized)"})
        has_more = True
        while has_more:
            has_more = self.execute_next_task()

if __name__ == "__main__":
    orchestrator = Orchestrator()
    orchestrator.run_all()