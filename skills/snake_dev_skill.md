# Skill: Nokia Snake Game Development Guidelines

## Coding Guidelines
1. Write pure, modern Python 3.11 code.
2. Maintain strict separation of concerns: game logic (`snake_engine.py`) must be independent from UI rendering (`main.py`).
3. Always handle Pygame events cleanly so the application window closes without freezing.
4. Output only valid, runnable Python code without markdown codeblocks or conversational preamble.

## Game Rules
- Snake starts with length 3 moving RIGHT.
- Food spawns randomly on grid coordinates not occupied by the snake body.
- When head hits food, snake grows by 1 segment and score increases by 10.
- When head hits outer boundary or self body, set `game_over = True`.