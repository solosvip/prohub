import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import './SnakeGame.css'

const GRID_SIZE = 20
const CELL_SIZE = 1
const INITIAL_SPEED = 200
const SPEED_INCREMENT = 10
const LEVEL_THRESHOLD = 5

const DIFFICULTY_LEVELS = {
  EASY: { speed: 250, name: '简单' },
  NORMAL: { speed: 200, name: '正常' },
  HARD: { speed: 150, name: '困难' },
}

const FOOD_TYPES = {
  NORMAL: { color: 0xff0000, points: 1, speedChange: 0, name: '普通食物' },
  SPEED_UP: { color: 0xffff00, points: 2, speedChange: -20, name: '加速食物' },
  SLOW_DOWN: { color: 0x00ffff, points: 3, speedChange: 20, name: '减速食物' },
}

const DIRECTIONS = {
  UP: { x: 0, z: -1 },
  DOWN: { x: 0, z: 1 },
  LEFT: { x: -1, z: 0 },
  RIGHT: { x: 1, z: 0 },
}

function SnakeGame() {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const snakeRef = useRef([])
  const foodRef = useRef(null)
  const gameLoopRef = useRef(null)
  const directionRef = useRef(DIRECTIONS.RIGHT)
  const nextDirectionRef = useRef(DIRECTIONS.RIGHT)

  const [gameState, setGameState] = useState('menu') // menu, playing, paused, gameOver
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [speed, setSpeed] = useState(INITIAL_SPEED)
  const [difficulty, setDifficulty] = useState('NORMAL')
  const [highScore, setHighScore] = useState(0)
  const [currentFoodType, setCurrentFoodType] = useState('NORMAL')

  useEffect(() => {
    const savedHighScore = localStorage.getItem('snakeHighScore')
    if (savedHighScore) {
      setHighScore(parseInt(savedHighScore))
    }
  }, [])

  const initThreeJS = useCallback(() => {
    if (!mountRef.current) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera - Isometric view
    const aspect = window.innerWidth / window.innerHeight
    const distance = GRID_SIZE * 1.5
    const camera = new THREE.OrthographicCamera(
      -distance * aspect,
      distance * aspect,
      distance,
      -distance,
      0.1,
      1000
    )
    camera.position.set(distance, distance, distance)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    rendererRef.current = renderer
    mountRef.current.appendChild(renderer.domElement)

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    directionalLight.castShadow = true
    directionalLight.shadow.camera.left = -GRID_SIZE
    directionalLight.shadow.camera.right = GRID_SIZE
    directionalLight.shadow.camera.top = GRID_SIZE
    directionalLight.shadow.camera.bottom = -GRID_SIZE
    scene.add(directionalLight)

    // Ground
    const groundGeometry = new THREE.BoxGeometry(GRID_SIZE, 0.2, GRID_SIZE)
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x16213e,
      roughness: 0.7,
      metalness: 0.1
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.position.y = -0.1
    ground.receiveShadow = true
    scene.add(ground)

    // Grid helper
    const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x0f3460, 0x0f3460)
    gridHelper.position.y = 0
    scene.add(gridHelper)

    // Walls
    const wallMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x533483,
      roughness: 0.5,
      metalness: 0.2
    })
    const wallHeight = 2
    const wallThickness = 0.2

    // North wall
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(GRID_SIZE + wallThickness * 2, wallHeight, wallThickness),
      wallMaterial
    )
    northWall.position.set(0, wallHeight / 2, -GRID_SIZE / 2 - wallThickness / 2)
    northWall.castShadow = true
    scene.add(northWall)

    // South wall
    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(GRID_SIZE + wallThickness * 2, wallHeight, wallThickness),
      wallMaterial
    )
    southWall.position.set(0, wallHeight / 2, GRID_SIZE / 2 + wallThickness / 2)
    southWall.castShadow = true
    scene.add(southWall)

    // West wall
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, GRID_SIZE),
      wallMaterial
    )
    westWall.position.set(-GRID_SIZE / 2 - wallThickness / 2, wallHeight / 2, 0)
    westWall.castShadow = true
    scene.add(westWall)

    // East wall
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, GRID_SIZE),
      wallMaterial
    )
    eastWall.position.set(GRID_SIZE / 2 + wallThickness / 2, wallHeight / 2, 0)
    eastWall.castShadow = true
    scene.add(eastWall)

    // Handle window resize
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight
      const distance = GRID_SIZE * 1.5
      camera.left = -distance * aspect
      camera.right = distance * aspect
      camera.top = distance
      camera.bottom = -distance
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  const createSnakeSegment = useCallback((x, z, isHead = false) => {
    const geometry = new THREE.BoxGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.8, CELL_SIZE * 0.9)
    const material = new THREE.MeshStandardMaterial({
      color: isHead ? 0x00ff00 : 0x0fd850,
      roughness: 0.3,
      metalness: 0.6
    })
    const segment = new THREE.Mesh(geometry, material)
    segment.position.set(x, CELL_SIZE * 0.4, z)
    segment.castShadow = true
    segment.receiveShadow = true

    if (isHead) {
      // Add eyes to the head
      const eyeGeometry = new THREE.SphereGeometry(0.1, 8, 8)
      const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })
      
      const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
      leftEye.position.set(-0.2, 0.2, 0.4)
      segment.add(leftEye)
      
      const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
      rightEye.position.set(0.2, 0.2, 0.4)
      segment.add(rightEye)
    }

    sceneRef.current.add(segment)
    return segment
  }, [])

  const createFood = useCallback(() => {
    if (foodRef.current) {
      sceneRef.current.remove(foodRef.current)
    }

    let x, z, isValid
    do {
      x = Math.floor(Math.random() * GRID_SIZE) - GRID_SIZE / 2
      z = Math.floor(Math.random() * GRID_SIZE) - GRID_SIZE / 2
      isValid = !snakeRef.current.some(seg => 
        Math.abs(seg.position.x - x) < 0.1 && Math.abs(seg.position.z - z) < 0.1
      )
    } while (!isValid)

    // Random food type
    const foodTypes = Object.keys(FOOD_TYPES)
    const randomType = foodTypes[Math.floor(Math.random() * foodTypes.length)]
    setCurrentFoodType(randomType)

    const foodType = FOOD_TYPES[randomType]
    const geometry = new THREE.SphereGeometry(CELL_SIZE * 0.4, 16, 16)
    const material = new THREE.MeshStandardMaterial({
      color: foodType.color,
      emissive: foodType.color,
      emissiveIntensity: 0.3,
      roughness: 0.2,
      metalness: 0.8
    })
    const food = new THREE.Mesh(geometry, material)
    food.position.set(x, CELL_SIZE * 0.4, z)
    food.castShadow = true

    sceneRef.current.add(food)
    foodRef.current = food

    // Animate food
    const animateFood = () => {
      if (food.parent) {
        food.rotation.y += 0.02
        food.position.y = CELL_SIZE * 0.4 + Math.sin(Date.now() * 0.003) * 0.1
        requestAnimationFrame(animateFood)
      }
    }
    animateFood()
  }, [])

  const initGame = useCallback(() => {
    // Clear existing snake
    snakeRef.current.forEach(segment => sceneRef.current.remove(segment))
    snakeRef.current = []

    // Create initial snake
    const startX = 0
    const startZ = 0
    snakeRef.current = [
      createSnakeSegment(startX, startZ, true),
      createSnakeSegment(startX - CELL_SIZE, startZ),
      createSnakeSegment(startX - CELL_SIZE * 2, startZ),
    ]

    directionRef.current = DIRECTIONS.RIGHT
    nextDirectionRef.current = DIRECTIONS.RIGHT

    createFood()

    setScore(0)
    setLevel(1)
    setSpeed(DIFFICULTY_LEVELS[difficulty].speed)
  }, [createSnakeSegment, createFood, difficulty])

  const checkCollision = useCallback((head) => {
    const halfGrid = GRID_SIZE / 2

    // Wall collision
    if (
      head.position.x < -halfGrid + CELL_SIZE / 2 ||
      head.position.x > halfGrid - CELL_SIZE / 2 ||
      head.position.z < -halfGrid + CELL_SIZE / 2 ||
      head.position.z > halfGrid - CELL_SIZE / 2
    ) {
      return true
    }

    // Self collision
    for (let i = 1; i < snakeRef.current.length; i++) {
      const segment = snakeRef.current[i]
      if (
        Math.abs(head.position.x - segment.position.x) < 0.1 &&
        Math.abs(head.position.z - segment.position.z) < 0.1
      ) {
        return true
      }
    }

    return false
  }, [])

  const moveSnake = useCallback(() => {
    directionRef.current = nextDirectionRef.current

    const head = snakeRef.current[0]
    const newX = head.position.x + directionRef.current.x * CELL_SIZE
    const newZ = head.position.z + directionRef.current.z * CELL_SIZE

    const newHead = createSnakeSegment(newX, newZ, true)

    // Check collision before committing the move
    if (checkCollision(newHead)) {
      sceneRef.current.remove(newHead)
      setGameState('gameOver')
      return
    }

    // Update head appearance
    const oldHead = snakeRef.current[0]
    oldHead.material.color.setHex(0x0fd850)
    while (oldHead.children.length > 0) {
      oldHead.remove(oldHead.children[0])
    }

    snakeRef.current.unshift(newHead)

    // Check food collision
    const food = foodRef.current
    if (
      Math.abs(newHead.position.x - food.position.x) < CELL_SIZE / 2 &&
      Math.abs(newHead.position.z - food.position.z) < CELL_SIZE / 2
    ) {
      // Eat food
      const foodType = FOOD_TYPES[currentFoodType]
      setScore(prev => {
        const newScore = prev + foodType.points
        const newLevel = Math.floor(newScore / LEVEL_THRESHOLD) + 1
        setLevel(newLevel)
        
        // Update speed
        const baseSpeed = DIFFICULTY_LEVELS[difficulty].speed
        const newSpeed = Math.max(50, baseSpeed - (newLevel - 1) * SPEED_INCREMENT + foodType.speedChange)
        setSpeed(newSpeed)
        
        return newScore
      })
      
      createFood()
    } else {
      // Remove tail if no food eaten
      const tail = snakeRef.current.pop()
      sceneRef.current.remove(tail)
    }
  }, [createSnakeSegment, checkCollision, createFood, currentFoodType, difficulty])

  const startGame = useCallback(() => {
    if (!sceneRef.current) {
      initThreeJS()
    }
    initGame()
    setGameState('playing')
  }, [initThreeJS, initGame])

  const pauseGame = useCallback(() => {
    setGameState('paused')
  }, [])

  const resumeGame = useCallback(() => {
    setGameState('playing')
  }, [])

  const restartGame = useCallback(() => {
    // Update high score
    if (score > highScore) {
      setHighScore(score)
      localStorage.setItem('snakeHighScore', score.toString())
    }
    startGame()
  }, [score, highScore, startGame])

  useEffect(() => {
    if (gameState === 'playing') {
      gameLoopRef.current = setInterval(() => {
        moveSnake()
      }, speed)
    } else {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }

    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [gameState, speed, moveSnake])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState === 'playing') {
        const currentDir = directionRef.current

        switch (e.key) {
          case 'ArrowUp':
          case 'w':
          case 'W':
            if (currentDir !== DIRECTIONS.DOWN) {
              nextDirectionRef.current = DIRECTIONS.UP
            }
            e.preventDefault()
            break
          case 'ArrowDown':
          case 's':
          case 'S':
            if (currentDir !== DIRECTIONS.UP) {
              nextDirectionRef.current = DIRECTIONS.DOWN
            }
            e.preventDefault()
            break
          case 'ArrowLeft':
          case 'a':
          case 'A':
            if (currentDir !== DIRECTIONS.RIGHT) {
              nextDirectionRef.current = DIRECTIONS.LEFT
            }
            e.preventDefault()
            break
          case 'ArrowRight':
          case 'd':
          case 'D':
            if (currentDir !== DIRECTIONS.LEFT) {
              nextDirectionRef.current = DIRECTIONS.RIGHT
            }
            e.preventDefault()
            break
          case ' ':
          case 'Escape':
            pauseGame()
            e.preventDefault()
            break
          default:
            break
        }
      } else if (gameState === 'paused' && (e.key === ' ' || e.key === 'Escape')) {
        resumeGame()
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [gameState, pauseGame, resumeGame])

  useEffect(() => {
    initThreeJS()
    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [initThreeJS])

  return (
    <div className="snake-game">
      <div ref={mountRef} className="game-canvas" />

      {gameState === 'menu' && (
        <div className="game-overlay">
          <div className="menu-panel">
            <h1 className="game-title">2.5D 贪食蛇</h1>
            <div className="menu-content">
              <div className="difficulty-selector">
                <h3>选择难度</h3>
                <div className="difficulty-buttons">
                  {Object.entries(DIFFICULTY_LEVELS).map(([key, value]) => (
                    <button
                      key={key}
                      className={`difficulty-btn ${difficulty === key ? 'active' : ''}`}
                      onClick={() => setDifficulty(key)}
                    >
                      {value.name}
                    </button>
                  ))}
                </div>
              </div>
              <button className="start-btn" onClick={startGame}>
                开始游戏
              </button>
              <div className="high-score">
                <p>最高分: {highScore}</p>
              </div>
              <div className="controls-info">
                <h3>操作说明</h3>
                <p>方向键 / WASD - 移动</p>
                <p>空格 / ESC - 暂停</p>
              </div>
              <div className="food-info">
                <h3>食物类型</h3>
                <div className="food-types">
                  {Object.entries(FOOD_TYPES).map(([key, value]) => (
                    <div key={key} className="food-type-item">
                      <div 
                        className="food-color" 
                        style={{ backgroundColor: `#${value.color.toString(16).padStart(6, '0')}` }}
                      />
                      <span>{value.name} (+{value.points}分)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="game-hud">
          <div className="hud-item">
            <span className="hud-label">分数:</span>
            <span className="hud-value">{score}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">等级:</span>
            <span className="hud-value">{level}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">速度:</span>
            <span className="hud-value">{Math.round(1000 / speed)}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">长度:</span>
            <span className="hud-value">{snakeRef.current.length}</span>
          </div>
        </div>
      )}

      {gameState === 'paused' && (
        <div className="game-overlay">
          <div className="pause-panel">
            <h2>游戏暂停</h2>
            <p>按空格或ESC继续</p>
            <div className="pause-stats">
              <p>当前分数: {score}</p>
              <p>当前等级: {level}</p>
            </div>
            <div className="pause-buttons">
              <button className="resume-btn" onClick={resumeGame}>
                继续游戏
              </button>
              <button className="menu-btn" onClick={() => setGameState('menu')}>
                返回菜单
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'gameOver' && (
        <div className="game-overlay">
          <div className="game-over-panel">
            <h2 className="game-over-title">游戏结束</h2>
            <div className="final-stats">
              <div className="stat-item">
                <span className="stat-label">最终分数</span>
                <span className="stat-value">{score}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">最终等级</span>
                <span className="stat-value">{level}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">蛇身长度</span>
                <span className="stat-value">{snakeRef.current.length}</span>
              </div>
              {score > highScore && (
                <div className="new-high-score">
                  🎉 新纪录！
                </div>
              )}
              <div className="stat-item">
                <span className="stat-label">历史最高分</span>
                <span className="stat-value">{Math.max(score, highScore)}</span>
              </div>
            </div>
            <div className="game-over-buttons">
              <button className="restart-btn" onClick={restartGame}>
                再来一局
              </button>
              <button className="menu-btn" onClick={() => setGameState('menu')}>
                返回菜单
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SnakeGame
