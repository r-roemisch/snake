import logging
import json
from datetime import datetime

class AuditLogger:
    def __init__(self, log_file="audit.log"):
        self.logger = logging.getLogger("SoftwareFactory")
        self.logger.setLevel(logging.INFO)
        
        if not self.logger.handlers:
            # File handler (continuous append)
            file_handler = logging.FileHandler(log_file, mode='a', encoding='utf-8')
            formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)
            
            # Console handler
            console_handler = logging.StreamHandler()
            console_handler.setFormatter(formatter)
            self.logger.addHandler(console_handler)

    def log(self, agent_id: str, action: str, details: dict):
        payload = {
            "timestamp": datetime.now().isoformat(),
            "agent": agent_id,
            "action": action,
            "details": details
        }
        self.logger.info(json.dumps(payload))