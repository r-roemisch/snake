import os
import json
import urllib.request

def load_env():
    """Simple parser for .env file."""
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()

class OpenRouterAgent:
    def __init__(self, agent_name="dev_agent"):
        load_env()
        self.agent_name = agent_name
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        self.model = os.getenv("DEFAULT_MODEL", "anthropic/claude-3.5-sonnet")
        
        if not self.api_key or self.api_key == "your_openrouter_api_key_here":
            raise ValueError("Missing valid OPENROUTER_API_KEY in .env file.")

    def run_task(self, prompt: str) -> str:
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are an expert Python software engineer agent working in an automated software factory."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2
        }

        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
        
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            raw_code = result['choices'][0]['message']['content']
            
            # Strip markdown formatting if the model includes it
            cleaned = raw_code.replace("```python", "").replace("```", "").strip()
            return cleaned