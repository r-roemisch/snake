# Snake

A browser snake game: classic grid rules, presented with smooth motion and a neon-arcade look.

## Language

### The world

**Arena**:
The fixed rectangular grid of cells where a run takes place.
_Avoid_: Board, field, map, level

**Cell**:
One square of the arena; every position in the game is a cell.
_Avoid_: Tile, block, square

**Wall**:
The deadly border enclosing the arena. The arena does not wrap around.
_Avoid_: Edge, boundary

### The snake

**Snake**:
The player-controlled chain of segments, led by its head.
_Avoid_: Player, worm

**Head**:
The leading segment of the snake; the only segment that eats or collides.

**Segment**:
One cell's worth of the snake's body.
_Avoid_: Block, piece, node, tail-part

**Turn**:
A change in the direction the snake is travelling. The snake can never turn straight back on itself.
_Avoid_: Move

**Food**:
An item occupying a cell; when the head enters that cell the snake grows by one segment.
_Avoid_: Fruit, apple, pellet

**Golden food**:
A rare kind of food that vanishes after a few seconds and is worth far more points than regular food.
_Avoid_: Bonus, special food, gold

**Death**:
The end of a run, caused by the head entering a wall or one of the snake's own segments.
_Avoid_: Crash, game over

### Scoring

**Score**:
The points earned during the current run.
_Avoid_: Points total

**High score**:
The highest score ever reached on this device.
_Avoid_: Best, record

**Combo**:
A chain of food eaten in quick succession; it breaks if the next food takes longer to reach than the direct route plus a little slack.
_Avoid_: Streak, chain

**Multiplier**:
The factor applied to the points for each food, determined by the current combo.
_Avoid_: Bonus

### Time

**Tick**:
One step of the game rules, in which the snake advances exactly one cell.
_Avoid_: Frame, step, move

**Run**:
One attempt, from the snake's first turn until its death or a perfect.
_Avoid_: Game, round, life

**Perfect**:
A run that ends with the snake filling every cell of the arena; the only way to win.
_Avoid_: Victory, clear
