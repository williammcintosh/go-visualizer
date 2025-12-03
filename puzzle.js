const MIN_STONES = 5;
const lastGameByBoard = {};

function getStoneKey(stoneCount) {
  const parsed = Number(stoneCount);
  return Number.isFinite(parsed) ? parsed : MIN_STONES;
}

function getBoardStoneBucket(bucket, boardKey) {
  const existing = bucket?.[boardKey];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing;
  }
  if (Number.isFinite(existing)) {
    return { [MIN_STONES]: existing };
  }
  return {};
}

function getPlayerProgressIndex(playerProgress, mode, boardKey, stoneCount, total) {
  const bucket = playerProgress?.[mode] || {};
  const stoneKey = getStoneKey(stoneCount);
  const boardBucket = getBoardStoneBucket(bucket, boardKey);
  const legacyValue = Number(bucket?.[boardKey]);
  const rawValue =
    Number.isFinite(boardBucket[stoneKey])
      ? boardBucket[stoneKey]
      : stoneKey === MIN_STONES && Number.isFinite(legacyValue)
      ? legacyValue
      : 0;
  const parsed = Number.isFinite(rawValue) ? rawValue : 0;
  return total > 0 ? ((parsed % total) + total) % total : 0;
}

function incrementPlayerProgress(
  playerProgress,
  mode,
  boardKey,
  stoneCount,
  total,
  savePlayerProgress
) {
  if (total <= 0) return;
  const bucket = playerProgress[mode] || {};
  const stoneKey = getStoneKey(stoneCount);
  const boardBucket = getBoardStoneBucket(bucket, boardKey);
  const currentIndex = getPlayerProgressIndex(
    playerProgress,
    mode,
    boardKey,
    stoneKey,
    total
  );
  const nextIndex = (currentIndex + 1) % total;
  boardBucket[stoneKey] = nextIndex;
  bucket[boardKey] = boardBucket;
  playerProgress[mode] = bucket;
  if (typeof savePlayerProgress === 'function') {
    savePlayerProgress(playerProgress);
  }
}

function getChallengeAttemptKey(gameId, index) {
  if (Number.isFinite(Number(gameId))) return `id:${gameId}`;
  if (Number.isFinite(Number(index))) return `idx:${index}`;
  return 'unknown';
}

function recordChallengeAttempt(
  challengeAttempts,
  mode,
  boardKey,
  { gameId, index },
  saveChallengeAttempts
) {
  const safeMode = mode === 'sequence' ? 'sequence' : 'position';
  const bucket = challengeAttempts[safeMode] || {};
  const perBoard = bucket[boardKey] || {};
  const key = getChallengeAttemptKey(gameId, index);
  const current = Number(perBoard[key]);
  const next = Number.isFinite(current) ? current + 1 : 1;
  perBoard[key] = next;
  bucket[boardKey] = perBoard;
  challengeAttempts[safeMode] = bucket;
  if (typeof saveChallengeAttempts === 'function') {
    saveChallengeAttempts(challengeAttempts);
  }
  return next;
}

function getChallengeAttemptCount(challengeAttempts, mode, boardKey, { gameId, index }) {
  const safeMode = mode === 'sequence' ? 'sequence' : 'position';
  const bucket = challengeAttempts?.[safeMode] || {};
  const perBoard = bucket?.[boardKey] || {};
  const key = getChallengeAttemptKey(gameId, index);
  const current = Number(perBoard[key]);
  return Number.isFinite(current) ? current : 0;
}

function determineBoardKey(library, targetSize) {
  if (!library) return null;
  const availableSizes = Object.keys(library)
    .map((key) => {
      const dim = Number(key.split('x')[0]);
      return Number.isNaN(dim) ? null : dim;
    })
    .filter((size) => size !== null)
    .sort((a, b) => a - b);
  if (!availableSizes.length) return null;
  if (availableSizes.includes(targetSize)) {
    return `${targetSize}x${targetSize}`;
  }
  const fallback = availableSizes.filter((size) => size <= targetSize).pop();
  const sizeToUse = fallback ?? availableSizes[0];
  return `${sizeToUse}x${sizeToUse}`;
}

async function selectGameForLevel(targetSize, stoneCount, mode, playerProgress) {
  const library = await window.GoMiniBoardLogic.loadMiniBoards();
  const boardKey = determineBoardKey(library, targetSize);
  if (!boardKey || !Array.isArray(library[boardKey])) {
    throw new Error(`No games available for ${targetSize}x${targetSize}`);
  }
  const games = library[boardKey];
  const targetCount = Number.isFinite(Number(stoneCount))
    ? Number(stoneCount)
    : null;
  const matchingGames =
    targetCount === null
      ? games
      : games.filter((game) => Number(game.num_moves) === targetCount);
  const pool = matchingGames.length ? matchingGames : games;
  if (!pool.length) {
    throw new Error(
      `No games available for ${boardKey} with ${targetCount ?? 'any'} stones`
    );
  }
  const safeMode = mode === 'sequence' ? 'sequence' : 'position';
  const index = getPlayerProgressIndex(
    playerProgress,
    safeMode,
    boardKey,
    targetCount,
    pool.length
  );
  const selected = pool[index];
  lastGameByBoard[boardKey] = selected?.game_id;
  return {
    boardKey,
    game: selected,
    challengeMeta: {
      index,
      poolSize: pool.length,
      stoneCount: targetCount,
      mode: safeMode,
    },
  };
}

async function loadPuzzleForGame({
  boardDimension,
  config,
  currentMode,
  playerProgress,
  challengeAttempts,
  savePlayerProgress,
  saveChallengeAttempts,
  activeGame,
}) {
  const selection = await selectGameForLevel(
    boardDimension,
    config.stoneCount,
    currentMode,
    playerProgress
  );
  const boardKey = selection.boardKey;
  const selectedGame = selection.game;
  const stoneTarget = Number.isFinite(Number(selectedGame?.num_moves))
    ? Number(selectedGame.num_moves)
    : config.stoneCount;
  if (activeGame) {
    activeGame.puzzleConfig = {
      stoneCount: stoneTarget,
      boardSize: boardDimension,
    };
    activeGame.challengeIndex = selection.challengeMeta?.index ?? 0;
    activeGame.challengePoolSize = selection.challengeMeta?.poolSize ?? 0;
    activeGame.challengeStoneCount =
      selection.challengeMeta?.stoneCount ?? stoneTarget;
    activeGame.challengeMode = selection.challengeMeta?.mode ?? currentMode;
  }
  const snapshot = await window.GoMiniBoardLogic.getGameSnapshot({
    size: boardKey,
    gameId: selectedGame.game_id,
    stoneTarget,
  });
  if (activeGame) {
    activeGame.selectedGame = selectedGame;
    activeGame.boardKey = boardKey;
    activeGame.gameSnapshot = snapshot;
  }

  const attempts = recordChallengeAttempt(
    challengeAttempts,
    activeGame?.challengeMode || currentMode,
    activeGame?.boardKey || boardKey,
    {
      gameId: activeGame?.selectedGame?.game_id ?? selectedGame?.game_id,
      index: activeGame?.challengeIndex ?? 0,
    },
    saveChallengeAttempts
  );
  if (activeGame) {
    activeGame.challengeAttempts = attempts;
  }

  const stones = Object.entries(snapshot.stoneMap).map(([coords, stoneColor]) => {
    const [x, y] = coords.split(',').map(Number);
    return {
      x,
      y,
      color: stoneColor === 'B' ? 'black' : 'white',
    };
  });

  return {
    selection,
    snapshot,
    selectedGame,
    boardKey,
    stoneTarget,
    stones,
  };
}

function mapStoneMapToStones(stoneMap) {
  if (!stoneMap || typeof stoneMap !== 'object') return [];
  return Object.entries(stoneMap).map(([coords, stoneColor]) => {
    const [x, y] = coords.split(',').map(Number);
    return { x, y, color: stoneColor === 'B' ? 'black' : 'white' };
  });
}

async function preparePuzzleData({
  boardDimension,
  config,
  currentMode,
  playerProgress,
  challengeAttempts,
  savePlayerProgress,
  saveChallengeAttempts,
  activeGame,
}) {
  return loadPuzzleForGame({
    boardDimension,
    config,
    currentMode,
    playerProgress,
    challengeAttempts,
    savePlayerProgress,
    saveChallengeAttempts,
    activeGame,
  });
}

export {
  determineBoardKey,
  selectGameForLevel,
  getPlayerProgressIndex,
  incrementPlayerProgress,
  recordChallengeAttempt,
  getChallengeAttemptCount,
  loadPuzzleForGame,
  mapStoneMapToStones,
  preparePuzzleData,
};
