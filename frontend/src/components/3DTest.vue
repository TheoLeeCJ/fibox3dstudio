<script setup>
    import { inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
    import { generateImage, generate3DModel, fiboRender } from '../api'

    const studioBoundingBoxes = inject('studioBoundingBoxes', null)
    const studioGlbAssignments = inject('studioGlbAssignments', null)

    const canvasRef = ref(null)
    const showObjectBoxes = ref(false)
    const sunlightEnabled = ref(true)
    const showFullRoom = ref(false)
    const roomStructureMode = ref('default') // 'default' or 'generated'
    const roomLightEnabled = ref(false)
    const roomLightColor = ref('#ffffff')
    const roomLightIntensity = ref(1)
    const ambientIntensity = ref(0.75)
    const ssaoEnabled = ref(true)
    const isFirstPersonCamera = ref(false)
    const sceneBackground = ref('Evening') // 'Evening', 'Day', 'Studio'
    
    // Edit Object Dialog
    const showEditDialog = ref(false)
    const editDialogImage = ref('')
    const editDialogText = ref('')
    const editedImage = ref('') // Holds the edited image from FIBO
    const isEditingImage = ref(false) // Loading state for FIBO
    const isRegenerating3D = ref(false) // Loading state for Trellis
    const showEditBefore = ref(true) // Toggle for before/after view
    
    // FIBO Render states
    const showRenderPrompt = ref(false)
    const isRenderingWithFIBO = ref(false)
    const fiboRenderResults = ref([])
    const showRenderResults = ref(false)

    let engine, scene
    let roomMesh = null
    let roomRotation = 0 // Track room Y rotation in degrees
    let testBox = null
    let bboxRoot = null
    let debugBoxRoot = null
    let glbRoot = null
    let placedGLBs = []
    const placedByKeyIndex = new Map() // `${key}__${index}` -> wrapper
    let arcCamera = null
    let freeCamera = null
    let gizmoManager = null
    let shadowGenerator = null
    let dirLight = null // Store reference for sunlight
    let roomLight = null // Store reference for room spotlight
    let roomLightShadowGen = null // Shadow generator for room light
    let hemisphericLight = null // Store reference for ambient light
    let highlightLayer = null // For outline rendering
    let ssao = null // Store reference for SSAO toggle
    let cameraSettings = { speed: 0.1, limit: 2.5, height: 1 }
    let studioPlane = null // White plane for studio background
    let skybox = null // Store skybox reference
    let fullRoomMesh = null // Mirrored copy of room for full 4-wall view
    let generatedRoomMesh = null // Generated room structure GLB
    
    // Gizmo UI overlay
    const selectedWrapper = ref(null)
    const gizmoUIPosition = ref({ x: 0, y: 0, visible: false })
    const selectedObjectScaleMultiplier = ref(1.0)

    // GUI Settings (moved from inline HTML inputs)
    const guiSettings = ref({
        bboxPlatformY: -1.5,
        bboxWorldSize: 6.5,
        bboxShowDebug: false,
        roomPosX: 0,
        roomPosY: 0.5,
        roomPosZ: 0,
        roomScaleX: 8,
        roomScaleY: 5,
        roomScaleZ: 8,
        glbScaleMult: 1.1,
        glbYOffset: -0.1,
        testBoxPosX: 0,
        testBoxPosY: -1.35,
        testBoxPosZ: 0,
        testBoxScaleX: 1,
        testBoxScaleY: 0.05,
        testBoxScaleZ: 1,
        studioPlaneHeight: -1.5
    })

    let resizeHandler = null
    let pointerObserver = null
    let gui = null

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = src
            s.onload = () => resolve()
            s.onerror = (e) => reject(e)
            document.head.appendChild(s)
        })
    }

    async function ensureBabylon() {
        if (window.BABYLON && window.dat) return
        const base = '/babylon/'
        await loadScript(base + 'babylon.js')
        await loadScript(base + 'babylon.glTFFileLoader.min.js')
        await loadScript(base + 'babylon.inspector.bundle.js')
        await loadScript(base + 'dat.gui.min.js')
    }

    onMounted(async () => {
        await ensureBabylon()
        const canvas = canvasRef.value
        engine = new BABYLON.Engine(canvas, true)
        scene = createScene(canvas)
        renderBoundingBoxes()
        updateObjectsList()
        
        // Auto-load all furniture objects (non-room-structure)
        await nextTick()
        if (objectsList.value && objectsList.value.length > 0) {
            for (const obj of objectsList.value) {
                // Skip room structure - only load furniture
                if (obj.key && obj.key.toLowerCase().includes('room structure')) continue
                if (obj.assignedUrl) {
                    await loadObjectGlb(obj)
                }
            }
        }
        
        engine.runRenderLoop(() => {
            if (scene && scene.render) {
                scene.render()
                if (selectedWrapper.value && gizmoUIPosition.value.visible) {
                    updateGizmoUIPosition()
                }
            }
        })
        resizeHandler = () => engine && engine.resize && engine.resize()
        window.addEventListener('resize', resizeHandler)
    })

    // Watch for GUI setting changes
    watch(() => guiSettings.value.bboxPlatformY, () => { renderBoundingBoxes(); updateAllPlacedGLBs() })
    watch(() => guiSettings.value.bboxWorldSize, () => { renderBoundingBoxes(); updateAllPlacedGLBs() })
    watch(() => showFullRoom.value, toggleFullRoom)
    watch(() => roomStructureMode.value, toggleRoomStructureMode)
    watch(() => guiSettings.value.bboxShowDebug, (val) => { if (debugBoxRoot) debugBoxRoot.setEnabled(val) })
    watch(() => guiSettings.value.glbScaleMult, () => updateAllPlacedGLBs())
    watch(() => guiSettings.value.glbYOffset, () => updateAllPlacedGLBs())
    watch(() => sunlightEnabled.value, toggleSunlight)
    watch(() => roomLightEnabled.value, toggleRoomLight)
    watch(() => roomLightColor.value, updateRoomLightColor)
    watch(() => roomLightIntensity.value, updateRoomLightIntensity)
    watch(() => ambientIntensity.value, updateAmbientIntensity)
    watch(() => ssaoEnabled.value, toggleSSAO)
    watch(() => showObjectBoxes.value, (val) => { if (debugBoxRoot) debugBoxRoot.setEnabled(val) })
    
    // Watch room transform settings
    watch(() => [guiSettings.value.roomPosX, guiSettings.value.roomPosY, guiSettings.value.roomPosZ, 
                  guiSettings.value.roomScaleX, guiSettings.value.roomScaleY, guiSettings.value.roomScaleZ],
          () => updateRoomTransform())

    onUnmounted(() => {
        try {
            if (pointerObserver) {
                scene?.onPointerObservable?.remove(pointerObserver)
                pointerObserver = null
            }
            if (gizmoManager) {
                try { gizmoManager.attachToMesh(null) } catch {}
                try { gizmoManager.dispose() } catch {}
                gizmoManager = null
            }
            if (shadowGenerator) {
                try { shadowGenerator.dispose() } catch {}
                shadowGenerator = null
            }
            if (gui) {
                try { gui.destroy() } catch {}
                gui = null
            }
            clearAllPlacedGLBs()
            if (debugBoxRoot) { try { debugBoxRoot.dispose() } catch {} debugBoxRoot = null }
            if (bboxRoot) { try { bboxRoot.dispose() } catch {} bboxRoot = null }
            if (glbRoot) { try { glbRoot.dispose() } catch {} glbRoot = null }
            if (testBox) { try { testBox.dispose() } catch {} testBox = null }
            if (roomMesh) { try { roomMesh.dispose() } catch {} roomMesh = null }
            if (scene) { try { scene.dispose() } catch {} scene = null }
            if (engine) {
                try { engine.stopRenderLoop() } catch {}
                try { engine.dispose() } catch {}
                engine = null
            }
            if (resizeHandler) {
                window.removeEventListener('resize', resizeHandler)
                resizeHandler = null
            }
        } catch {}
    })

    // When Ideation pushes floor-plan boxes + GLBs into shared state, auto-load them.
    // Track the previous keys to detect full scene changes vs incremental edits
    let prevBBoxKeys = new Set()
    // Debounce mechanism to prevent multiple simultaneous loads
    let pendingLoadTimeout = null
    let isLoadingGlbs = false
    
    async function debouncedSceneUpdate(shouldClearAll = false) {
        // Clear any pending update
        if (pendingLoadTimeout) {
            clearTimeout(pendingLoadTimeout)
            pendingLoadTimeout = null
        }
        
        // If already loading, schedule for later
        if (isLoadingGlbs) {
            pendingLoadTimeout = setTimeout(() => debouncedSceneUpdate(shouldClearAll), 100)
            return
        }
        
        // Small debounce to batch rapid changes
        await new Promise(resolve => {
            pendingLoadTimeout = setTimeout(resolve, 50)
        })
        pendingLoadTimeout = null
        
        if (shouldClearAll) {
            clearAllPlacedGLBs()
        }
        
        renderBoundingBoxes()
        updateObjectsList()
        
        isLoadingGlbs = true
        try {
            await loadAssignedGlbsIntoScene()
        } finally {
            isLoadingGlbs = false
        }
    }
    
    watch(
        () => studioBoundingBoxes && studioBoundingBoxes.value,
        async (val) => {
            if (!val) return
            await nextTick()
            
            // Check if this is a completely new scene (different object keys) or just an edit
            const currentKeys = new Set(Object.keys(val || {}))
            const isSameScene = currentKeys.size > 0 && 
                [...currentKeys].every(k => prevBBoxKeys.has(k)) && 
                [...prevBBoxKeys].every(k => currentKeys.has(k))
            
            const shouldClear = !isSameScene && prevBBoxKeys.size > 0
            prevBBoxKeys = currentKeys
            
            await debouncedSceneUpdate(shouldClear)
        },
        { deep: true }
    )

    watch(
        () => studioGlbAssignments && studioGlbAssignments.value,
        async () => {
            // Refresh the object list UI and load any newly assigned GLBs
            await nextTick()
            await debouncedSceneUpdate(false)
        },
        { deep: true }
    )

    function createScene(canvas) {
        const scene = new BABYLON.Scene(BABYLON.Engine.LastCreatedEngine)

        // Cameras
        arcCamera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.5, 15, new BABYLON.Vector3(0, 0, 0), scene)
        arcCamera.attachControl(canvas, true)
        arcCamera.wheelPrecision = 50
        arcCamera.minZ = 0.01
        arcCamera.maxZ = 50

        freeCamera = new BABYLON.FreeCamera('freeCamera', new BABYLON.Vector3(0, cameraSettings.height, -10), scene)
        freeCamera.keysUp.push(87)
        freeCamera.keysDown.push(83)
        freeCamera.keysLeft.push(65)
        freeCamera.keysRight.push(68)
        freeCamera.minZ = 0.01
        freeCamera.maxZ = 50
        freeCamera.speed = cameraSettings.speed

        // Gizmo
        gizmoManager = new BABYLON.GizmoManager(scene)
        gizmoManager.positionGizmoEnabled = true
        gizmoManager.rotationGizmoEnabled = true
        gizmoManager.scaleGizmoEnabled = false
        gizmoManager.boundingBoxGizmoEnabled = false
        // Match reference behavior: enable X/Y/Z axis gizmos, disable plane gizmos
        gizmoManager.gizmos.positionGizmo.xGizmo.isEnabled = true
        gizmoManager.gizmos.positionGizmo.yGizmo.isEnabled = true
        gizmoManager.gizmos.positionGizmo.zGizmo.isEnabled = true
        gizmoManager.gizmos.positionGizmo.xPlaneGizmo.isEnabled = false
        gizmoManager.gizmos.positionGizmo.yPlaneGizmo.isEnabled = false
        gizmoManager.gizmos.positionGizmo.zPlaneGizmo.isEnabled = false
        gizmoManager.attachableMeshes = []

        // Attach gizmo on click if wrapper found
        pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                // Only handle left-clicks (button 0)
                if (pointerInfo.event.button !== 0) return
                
                const pick = pointerInfo.pickInfo
                if (pick && pick.hit && pick.pickedMesh) {
                    console.log('[Pick]', pick.pickedMesh.name)
                    const wrapper = findWrapper(pick.pickedMesh)
                    if (wrapper) {
                        console.log('[Attach Gizmo] wrapper:', wrapper.name)
                        
                        // Clear previous selection outline
                        if (selectedWrapper.value && selectedWrapper.value !== wrapper) {
                            setWrapperHighlight(selectedWrapper.value, false)
                        }
                        
                        gizmoManager.attachToMesh(wrapper)
                        selectedWrapper.value = wrapper
                        selectedObjectScaleMultiplier.value = 1.0 // Reset scale multiplier on new selection
                        
                        // Enable outline on selected object using HighlightLayer
                        setWrapperHighlight(wrapper, true)
                        
                        if (gizmoManager.gizmos.rotationGizmo && gizmoManager.gizmos.rotationGizmo.setEnabledRotationAxis) {
                            gizmoManager.gizmos.rotationGizmo.setEnabledRotationAxis('y')
                        }
                        updateGizmoUIPosition()
                    }
                } else {
                    // Clear selection on non-mesh clicks
                    if (selectedWrapper.value) {
                        setWrapperHighlight(selectedWrapper.value, false)
                    }
                    gizmoManager.attachToMesh(null)
                    selectedWrapper.value = null
                    gizmoUIPosition.value.visible = false
                }
            }
        })

        // Lights
        hemisphericLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene)
        hemisphericLight.intensity = 0.5

        // Sunlight (directional)
        dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(0.44, -0.62, -0.64), scene)
        dirLight.position = new BABYLON.Vector3(20, 40, 20)
        dirLight.intensity = 2.5
        dirLight.autoCalcShadowZBounds = false

        // Shadows for sunlight
        shadowGenerator = new BABYLON.CascadedShadowGenerator(1024, dirLight)
        shadowGenerator.usePercentageCloserFiltering = true
        shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH
        shadowGenerator.bias = 0.005;
        
        // Room spotlight
        roomLight = new BABYLON.SpotLight('roomLight', new BABYLON.Vector3(0, 8, 0), new BABYLON.Vector3(0, -1, 0), Math.PI / 3, 2, scene)
        roomLight.intensity = roomLightIntensity.value
        roomLight.diffuse = BABYLON.Color3.FromHexString(roomLightColor.value)
        roomLight.setEnabled(roomLightEnabled.value)
        
        // Shadow generator for room light
        roomLightShadowGen = new BABYLON.ShadowGenerator(1024, roomLight)
        roomLightShadowGen.usePercentageCloserFiltering = true
        roomLightShadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH
        roomLightShadowGen.filter = 5
        roomLightShadowGen.bias = 0.001

        // Environment - Initialize with Evening
        const envTexture = new BABYLON.CubeTexture.CreateFromPrefilteredData('environment.env', scene)
        scene.environmentTexture = envTexture
        scene.iblIntensity = ambientIntensity.value
        skybox = scene.createDefaultSkybox(envTexture, true, 500)
        
        // HighlightLayer for object outlines
        highlightLayer = new BABYLON.HighlightLayer('hl1', scene)
        
        // Animate highlight
        let alpha = 0
        scene.registerBeforeRender(() => {
            alpha += 0.03
            highlightLayer.blurHorizontalSize = 0.3 + Math.cos(alpha) * 0.6 + 0.6
            highlightLayer.blurVerticalSize = 0.3 + Math.sin(alpha / 3) * 0.6 + 0.6
        })

        // SSAO similar to ed8.html
        ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.75, blurRatio: 0.75 }, null, false)
        ssao.expensiveBlur = true
        ssao.samples = 32
        scene.prePassRenderer.samples = 16
        scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', arcCamera)
        scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', freeCamera)

        // Base room (best-effort)
        BABYLON.SceneLoader.ImportMesh('', './', 'base-room-opt.glb', scene, (meshes) => {
          if (meshes.length > 0) {
            // Create a dedicated root for the room and parent all meshes to it.
            const roomRoot = new BABYLON.TransformNode('roomRoot', scene)
            meshes.forEach(m => {
              if (!m.parent) m.parent = roomRoot
              shadowGenerator.addShadowCaster(m)
              roomLightShadowGen.addShadowCaster(m)
              m.receiveShadows = true
              // Set material properties
              if (m.material) {
                if (m.material.roughness !== undefined) m.material.roughness = 1
                if (m.material.metallic !== undefined) m.material.metallic = 0
              }
            })
            // Use the transform node as the room mesh for transforms/rotation.
            roomMesh = roomRoot
            updateRoomTransform()
          }
        }, null, () => { })

        // dat.GUI - All debug controls
        gui = new dat.GUI()
        
        // Bounding Box Settings
        const bboxFolder = gui.addFolder('Bounding Box Settings')
        bboxFolder.add(guiSettings.value, 'bboxPlatformY', -5, 5, 0.1).name('Y Level')
        bboxFolder.add(guiSettings.value, 'bboxWorldSize', 1, 20, 0.1).name('Size')
        bboxFolder.add(guiSettings.value, 'bboxShowDebug').name('Show Debug Boxes')
        
        // Room Transform
        const roomFolder = gui.addFolder('Base Room Model')
        roomFolder.add(guiSettings.value, 'roomPosX', -10, 10, 0.1).name('Pos X')
        roomFolder.add(guiSettings.value, 'roomPosY', -10, 10, 0.1).name('Pos Y')
        roomFolder.add(guiSettings.value, 'roomPosZ', -10, 10, 0.1).name('Pos Z')
        roomFolder.add(guiSettings.value, 'roomScaleX', 0.1, 20, 0.1).name('Scale X')
        roomFolder.add(guiSettings.value, 'roomScaleY', 0.1, 20, 0.1).name('Scale Y')
        roomFolder.add(guiSettings.value, 'roomScaleZ', 0.1, 20, 0.1).name('Scale Z')
        
        // GLB Placement
        const glbFolder = gui.addFolder('GLB Placement Settings')
        glbFolder.add(guiSettings.value, 'glbScaleMult', 0.1, 3, 0.01).name('Scale Multiplier')
        glbFolder.add(guiSettings.value, 'glbYOffset', -5, 5, 0.1).name('Y Offset')
        
        // Studio Background
        const studioFolder = gui.addFolder('Studio Background')
        studioFolder.add(guiSettings.value, 'studioPlaneHeight', -5, 5, 0.1).name('Plane Height').onChange(() => {
            if (studioPlane) studioPlane.position.y = guiSettings.value.studioPlaneHeight
        })

        // Free Camera
        const camFolder = gui.addFolder('Free Camera')
        camFolder.add(cameraSettings, 'speed', 0.1, 5.0).name('Speed').onChange(v => { if (freeCamera) freeCamera.speed = v })
        camFolder.add(cameraSettings, 'limit', 1, 20).name('Move Limit')
        camFolder.add(cameraSettings, 'height', 0.1, 10).name('Height')

        // Free cam constraints
        scene.onBeforeRenderObservable.add(() => {
            if (scene.activeCamera === freeCamera) {
                freeCamera.position.y = cameraSettings.height
                const limit = cameraSettings.limit
                freeCamera.position.x = Math.max(-limit, Math.min(limit, freeCamera.position.x))
                freeCamera.position.z = Math.max(-limit, Math.min(limit, freeCamera.position.z))
            }
        })

        return scene
    }

    function findWrapper(mesh) {
        let curr = mesh
        while (curr) {
            if (curr.metadata) {
                if (curr.metadata.isGLBWrapper) return curr
                if (curr.metadata.wrapper) return curr.metadata.wrapper
            }
            curr = curr.parent
        }
        return null
    }

    function updateRoomTransform() {
        if (!roomMesh) return
        roomMesh.position.set(guiSettings.value.roomPosX, guiSettings.value.roomPosY, guiSettings.value.roomPosZ)
        roomMesh.scaling.set(guiSettings.value.roomScaleX, guiSettings.value.roomScaleY, guiSettings.value.roomScaleZ)
        roomMesh.rotation.y = (roomRotation * Math.PI) / 180
    }

    function toggleCamera() {
        if (!scene || !arcCamera || !freeCamera || !canvasRef.value) return
        const canvas = canvasRef.value
        if (scene.activeCamera === arcCamera) {
            scene.activeCamera.detachControl(canvas)
            freeCamera.position = arcCamera.position.clone()
            freeCamera.setTarget(BABYLON.Vector3.Zero())
            scene.activeCamera = freeCamera
            scene.activeCamera.attachControl(canvas, true)
            isFirstPersonCamera.value = true
        } else {
            scene.activeCamera.detachControl(canvas)
            scene.activeCamera = arcCamera
            scene.activeCamera.attachControl(canvas, true)
            isFirstPersonCamera.value = false
        }
    }

    function openInspector() {
        if (!scene) return
        if (scene.debugLayer.isVisible()) {
            scene.debugLayer.hide()
        } else {
            scene.debugLayer.show({ embedMode: true })
            scene.debugLayer.popupEmbed();
        }
    }

    function toggleSunlight() {
        if (!dirLight) return
        dirLight.setEnabled(sunlightEnabled.value)
    }

    function toggleRoomLight() {
        if (!roomLight) return
        roomLight.setEnabled(roomLightEnabled.value)
    }

    function updateRoomLightColor() {
        if (!roomLight) return
        roomLight.diffuse = BABYLON.Color3.FromHexString(roomLightColor.value)
    }

    function updateRoomLightIntensity() {
        if (!roomLight) return
        roomLight.intensity = roomLightIntensity.value
    }

    function updateAmbientIntensity() {
        if (!scene) return
        scene.iblIntensity = ambientIntensity.value
    }

    function toggleSSAO() {
        if (!scene || !ssao) return
        if (ssaoEnabled.value) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', scene.activeCamera)
        } else {
            scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', scene.activeCamera)
        }
    }

    function startRenderWithFIBO() {
        showRenderPrompt.value = true
    }
    
    function cancelRenderWithFIBO() {
        showRenderPrompt.value = false
    }
    
    async function renderWithFIBO() {
        if (!scene || !engine || !arcCamera) return
        
        showRenderPrompt.value = false
        isRenderingWithFIBO.value = true
        fiboRenderResults.value = []
        
        try {
            // Take screenshot with precision 1
            const screenshotData = await new Promise((resolve, reject) => {
                BABYLON.Tools.CreateScreenshot(engine, arcCamera, { precision: 1 }, (data) => {
                    resolve(data)
                }, 'image/png', false, 1.0, false)
            })
            
            // Call backend API to process the screenshot with FIBO (uses api helper to include auth token)
            const data = await fiboRender({ screenshot: screenshotData })

            // Map backend response to frontend format
            fiboRenderResults.value = (data.results || []).map(result => ({
                id: result.id,
                imageUrl: result.imageUrl
            }))
            
            showRenderResults.value = true
            
        } catch (error) {
            console.error('FIBO render error:', error)
            alert('Failed to render with FIBO: ' + error.message)
        } finally {
            isRenderingWithFIBO.value = false
        }
    }
    
    function closeRenderResults() {
        showRenderResults.value = false
        fiboRenderResults.value = []
    }
    
    function downloadRenderResult(imageUrl, index) {
        const link = document.createElement('a')
        link.href = imageUrl
        link.download = `fibo-render-${index}-${Date.now()}.png`
        link.click()
    }

    async function applySceneBackground() {
        if (!scene) return
        
        const bg = sceneBackground.value
        
        if (bg === 'Evening') {
            // Evening: Current environment.env with skybox
            const envTexture = new BABYLON.CubeTexture.CreateFromPrefilteredData('environment.env', scene)
            scene.environmentTexture = envTexture
            scene.iblIntensity = ambientIntensity.value
            if (skybox) skybox.dispose()
            skybox = scene.createDefaultSkybox(envTexture, true, 500)
            scene.clearColor = new BABYLON.Color4(0, 0, 0, 1)
            
            // Remove studio plane
            if (studioPlane) {
                studioPlane.dispose()
                studioPlane = null
            }
        } else if (bg === 'Day') {
            // Day: DayEnvironmentHDRI075_1K_HDR.exr with skybox
            const dayTexture = new BABYLON.EXRCubeTexture('DayEnvironmentHDRI075_1K_HDR.exr', scene, 512, false, true, false, true)
            scene.environmentTexture = dayTexture
            scene.iblIntensity = ambientIntensity.value
            if (skybox) skybox.dispose()
            skybox = scene.createDefaultSkybox(dayTexture, true, 500)
            scene.clearColor = new BABYLON.Color4(0, 0, 0, 1)
            
            // Remove studio plane
            if (studioPlane) {
                studioPlane.dispose()
                studioPlane = null
            }
        } else if (bg === 'Studio') {
            // Studio: Day EXR for IBL, white clear color, no skybox, white plane
            const dayTexture = new BABYLON.EXRCubeTexture('DayEnvironmentHDRI075_1K_HDR.exr', scene, 8, false, true, false, true)
            scene.environmentTexture = dayTexture
            scene.iblIntensity = ambientIntensity.value
            
            // Remove skybox
            if (skybox) {
                skybox.dispose()
                skybox = null
            }
            
            // White clear color
            scene.clearColor = new BABYLON.Color4(1, 1, 1, 1)
            
            // Create white plane if not exists
            if (!studioPlane) {
                studioPlane = BABYLON.MeshBuilder.CreateGround('studioPlane', { width: 100, height: 100 }, scene)
                const planeMat = new BABYLON.PBRMaterial('studioPlaneMat', scene)
                planeMat.albedoColor = new BABYLON.Color3(1, 1, 1)
                planeMat.roughness = 1
                planeMat.metallic = 0
                studioPlane.material = planeMat
                studioPlane.receiveShadows = true
                studioPlane.position.y = guiSettings.value.studioPlaneHeight
                if (shadowGenerator) shadowGenerator.addShadowCaster(studioPlane)
                if (roomLightShadowGen) roomLightShadowGen.addShadowCaster(studioPlane)
            }
        }
    }

    function rotateRoom90Degrees() {
        if (!roomMesh) {
            console.warn('Room mesh not loaded yet')
            return
        }
        roomRotation = (roomRotation + 90) % 360
        console.log('Rotating room to:', roomRotation, 'degrees')
        updateRoomTransform()
    }

    function toggleFullRoom() {
        if (showFullRoom.value) {
            // Create mirrored copy of room
            if (!fullRoomMesh && roomMesh) {
                BABYLON.SceneLoader.ImportMesh('', './', 'base-room-opt.glb', scene, (meshes) => {
                    if (meshes.length > 0) {
                        const fullRoomRoot = new BABYLON.TransformNode('fullRoomRoot', scene)
                        meshes.forEach(m => {
                            if (!m.parent) m.parent = fullRoomRoot
                            if (shadowGenerator) shadowGenerator.addShadowCaster(m)
                            if (roomLightShadowGen) roomLightShadowGen.addShadowCaster(m)
                            m.receiveShadows = true
                            if (m.material) {
                                if (m.material.roughness !== undefined) m.material.roughness = 1
                                if (m.material.metallic !== undefined) m.material.metallic = 0
                            }
                        })
                        fullRoomMesh = fullRoomRoot
                        // Position and rotate to show opposite walls
                        fullRoomMesh.position.set(guiSettings.value.roomPosX, guiSettings.value.roomPosY - 0.05, guiSettings.value.roomPosZ)
                        fullRoomMesh.scaling.set(guiSettings.value.roomScaleX, guiSettings.value.roomScaleY, guiSettings.value.roomScaleZ)
                        fullRoomMesh.rotation.y = ((roomRotation + 180) * Math.PI) / 180
                    }
                }, null, () => { })
            } else if (fullRoomMesh) {
                fullRoomMesh.setEnabled(true)
            }
        } else {
            // Hide mirrored room
            if (fullRoomMesh) {
                fullRoomMesh.setEnabled(false)
            }
        }
    }

    function toggleRoomStructureMode() {
        const currentMode = roomStructureMode.value
        
        if (currentMode === 'default') {
            // Show default room, hide generated
            if (roomMesh) roomMesh.setEnabled(true)
            if (fullRoomMesh && showFullRoom.value) fullRoomMesh.setEnabled(true)
            if (generatedRoomMesh) generatedRoomMesh.setEnabled(false)
        } else {
            // Show generated room, hide default
            if (roomMesh) roomMesh.setEnabled(false)
            if (fullRoomMesh) fullRoomMesh.setEnabled(false)
            if (generatedRoomMesh) generatedRoomMesh.setEnabled(true)
        }
    }

    function updateGizmoUIPosition() {
        if (!selectedWrapper.value || !scene || !engine) {
            gizmoUIPosition.value.visible = false
            return
        }
        
        // Get the position of the selected wrapper
        const worldPos = selectedWrapper.value.position
        
        // Project to screen space
        const screenCoords = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(),
            scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
        )
        
        gizmoUIPosition.value = {
            x: screenCoords.x + 96, // Offset +64px to the right
            y: screenCoords.y,
            visible: true
        }
    }

    function setWrapperHighlight(wrapper, enabled) {
        if (!wrapper || !highlightLayer) return
        const meshes = wrapper.getChildMeshes(false)
        const outlineColor = BABYLON.Color3.FromHexString('#FE8A18')
        
        if (enabled) {
            meshes.forEach(mesh => {
                highlightLayer.addMesh(mesh, outlineColor)
            })
        } else {
            meshes.forEach(mesh => {
                highlightLayer.removeMesh(mesh)
            })
        }
    }

    function rotateSelectedObject90() {
        if (!selectedWrapper.value) return
        selectedWrapper.value.rotation.y += Math.PI / 2
    }

    function resetSelectedObjectRotation() {
        if (!selectedWrapper.value) return
        selectedWrapper.value.rotation.x = 0
        selectedWrapper.value.rotation.y = 0
        selectedWrapper.value.rotation.z = 0
    }

    function updateSelectedObjectScale() {
        if (!selectedWrapper.value || !selectedWrapper.value.metadata) return
        const { baseScale } = selectedWrapper.value.metadata
        const scaleMultiplier = guiSettings.value.glbScaleMult
        const finalScale = baseScale * scaleMultiplier * selectedObjectScaleMultiplier.value
        selectedWrapper.value.scaling = new BABYLON.Vector3(finalScale, finalScale, finalScale)
    }

    function resetSelectedObjectScale() {
        selectedObjectScaleMultiplier.value = 1.0
        updateSelectedObjectScale()
    }

    async function duplicateObject(obj) {
        if (!obj || !studioBoundingBoxes?.value || !studioGlbAssignments?.value) return
        
        const { key, index, bbox, assignedUrl } = obj
        if (!bbox) return
        
        // Create a new offset bounding box (shift by 50 units in the 1000x1000 space = ~5% offset)
        const xOffset = 50
        const newBbox = [
            bbox[0],           // ymin
            bbox[1] + xOffset, // xmin - offset to the right
            bbox[2],           // ymax  
            bbox[3] + xOffset  // xmax - offset to the right
        ]
        
        // Add new bbox to studioBoundingBoxes
        if (!studioBoundingBoxes.value[key]) return
        const newIndex = studioBoundingBoxes.value[key].bounding_boxes.length
        studioBoundingBoxes.value[key].bounding_boxes.push(newBbox)
        
        // Copy the GLB assignment if there is one
        if (assignedUrl) {
            if (!studioGlbAssignments.value[key]) {
                studioGlbAssignments.value[key] = []
            }
            // Get existing assignment to copy imageUrl too
            const existingAssignment = studioGlbAssignments.value[key][index]
            if (typeof existingAssignment === 'object') {
                studioGlbAssignments.value[key][newIndex] = { ...existingAssignment }
            } else {
                studioGlbAssignments.value[key][newIndex] = assignedUrl
            }
        }
        
        // The watchers on studioBoundingBoxes and studioGlbAssignments will automatically:
        // - Update the objects list
        // - Render bounding boxes 
        // - Load the new GLB into the scene
    }

    async function duplicateSelectedObject() {
        if (!selectedWrapper.value?.metadata) return
        const { key, index, bbox } = selectedWrapper.value.metadata
        if (key === undefined || index === undefined || !bbox) return
        
        const assignedUrl = getAssignedGlbUrl(key, index)
        await duplicateObject({ key, index, bbox, assignedUrl })
    }

    function openEditDialog() {
        if (!selectedWrapper.value) return
        // Get the assigned image URL for this object if available
        const metadata = selectedWrapper.value.metadata
        if (metadata && metadata.key !== undefined && metadata.index !== undefined) {
            const imageUrl = getAssignedImageUrl(metadata.key, metadata.index)
            editDialogImage.value = imageUrl || ''
        }
        editDialogText.value = ''
        editedImage.value = ''
        showEditBefore.value = true
        showEditDialog.value = true
    }

    function closeEditDialog() {
        showEditDialog.value = false
        editDialogImage.value = ''
        editDialogText.value = ''
        editedImage.value = ''
        showEditBefore.value = true
    }

    async function applyEdit() {
        if (!editDialogImage.value || !editDialogText.value.trim()) {
            alert('Please provide both an image and a description')
            return
        }

        isEditingImage.value = true
        try {
            const fullPrompt = "Make this change while strongly and extremely carefully adhering to the current camera angle and lighting and do not change any other aspect of the scene: " + editDialogText.value
            
            const data = await generateImage({
                imageBase64: editDialogImage.value,
                prompt: fullPrompt,
                seed: 5555
            })

            editedImage.value = data.imageUrl
        } catch (error) {
            console.error('FIBO edit error:', error)
            alert('Error editing image: ' + error.message)
        } finally {
            isEditingImage.value = false
        }
    }

    async function acceptEdit() {
        if (!editedImage.value) return
        if (!selectedWrapper.value) return

        isRegenerating3D.value = true
        try {
            // Call backend API to regenerate 3D model from edited image
            const data = await generate3DModel({ imageUrl: editedImage.value })
            const newGlbUrl = data?.modelUrl || findFirstUrlWithExtensions(data, ['.glb', '.gltf', '.obj'])
            if (!newGlbUrl) {
                console.error('3D model response (no model url found):', data)
                throw new Error('3D generation succeeded but no model URL was found in response')
            }

            // Swap the model while preserving transforms
            await swapModel(selectedWrapper.value, newGlbUrl, editedImage.value)

            // Close dialog
            closeEditDialog()
        } catch (error) {
            console.error('3D regeneration error:', error)
            alert('Error regenerating 3D model: ' + error.message)
        } finally {
            isRegenerating3D.value = false
        }
    }

    function rejectEdit() {
        editedImage.value = ''
    }

    async function swapModel(wrapper, newGlbUrl, newImageUrl) {
        if (!wrapper) return

        // Store transform properties
        const position = wrapper.position.clone()
        const rotation = wrapper.rotation.clone()
        const scaling = wrapper.scaling.clone()
        const metadata = wrapper.metadata

        // Dispose all children (old model)
        wrapper.getChildMeshes().forEach(child => {
            if (child.material) child.material.dispose()
            child.dispose()
        })

        // Load new GLB
        const result = await BABYLON.SceneLoader.ImportMeshAsync('', newGlbUrl, '', scene)
        const newMeshes = result.meshes

        // Parent new meshes to the wrapper
        newMeshes.forEach(mesh => {
            if (!mesh.parent) {
                mesh.parent = wrapper
            }
            // Set material properties
            if (mesh.material) {
                mesh.material.roughness = 1
                mesh.material.metallic = 0
            }
        })

        // Restore transform properties
        wrapper.position = position
        wrapper.rotation = rotation
        wrapper.scaling = scaling

        // Update assignment if metadata exists
        if (metadata && metadata.key !== undefined && metadata.index !== undefined && studioGlbAssignments && studioGlbAssignments.value) {
            const key = metadata.key
            const index = metadata.index
            if (!studioGlbAssignments.value[key]) {
                studioGlbAssignments.value[key] = []
            }
            studioGlbAssignments.value[key][index] = { glbUrl: newGlbUrl, imageUrl: newImageUrl }
        }

        console.log('Model swapped successfully with preserved transforms')
    }

    function findFirstUrlWithExtensions(value, extensions) {
        const queue = [value]
        const seen = new Set()

        while (queue.length) {
            const curr = queue.shift()
            if (!curr) continue
            if (typeof curr === 'string') {
                const lower = curr.toLowerCase()
                if (extensions.some(ext => lower.endsWith(ext))) return curr
                continue
            }

            if (typeof curr !== 'object') continue
            if (seen.has(curr)) continue
            seen.add(curr)

            if (Array.isArray(curr)) {
                for (const item of curr) queue.push(item)
                continue
            }
            for (const k of Object.keys(curr)) queue.push(curr[k])
        }

        return null
    }

    async function handleFileUpload(event) {
        const files = event.target.files
        if (!files || files.length === 0) return
        
        // Process multiple GLB uploads
        for (const file of Array.from(files)) {
            const blobUrl = URL.createObjectURL(file)
            console.log('Uploaded GLB:', file.name, blobUrl)
            
            // Load the GLB into the scene at origin
            try {
                const result = await BABYLON.SceneLoader.ImportMeshAsync('', '', blobUrl, scene, null, '.glb')
                if (result.meshes.length > 0) {
                    const wrapper = new BABYLON.TransformNode('uploadedGLB_' + Date.now(), scene)
                    result.meshes.forEach(m => {
                        if (!m.parent) m.parent = wrapper
                        if (shadowGenerator) shadowGenerator.addShadowCaster(m)
                        if (roomLightShadowGen) roomLightShadowGen.addShadowCaster(m)
                        m.receiveShadows = true
                        if (m.material) {
                            if (m.material.roughness !== undefined) m.material.roughness = 1
                            if (m.material.metallic !== undefined) m.material.metallic = 0
                        }
                    })
                    wrapper.position.y = guiSettings.value.bboxPlatformY + 0.5
                    wrapper.metadata = { isGLBWrapper: true, isUploaded: true }
                    placedGLBs.push(wrapper)
                    console.log('Successfully loaded uploaded GLB:', file.name)
                }
            } catch (error) {
                console.error('Failed to load GLB:', file.name, error)
                alert('Failed to load ' + file.name)
            }
        }
        
        // Clear the input
        event.target.value = ''
    }

    // The following functions mirror the HTML version
    function renderBoundingBoxes() {
        if (!studioBoundingBoxes || !studioBoundingBoxes.value) return
        const data = studioBoundingBoxes.value

        // Ensure persistent roots exist
        if (!bboxRoot) bboxRoot = new BABYLON.TransformNode('bboxRoot', scene)
        if (!glbRoot) {
            glbRoot = new BABYLON.TransformNode('glbRoot', scene)
            glbRoot.parent = bboxRoot
        }

        // Dispose only the debug visualization root to avoid destroying placed GLBs
        if (debugBoxRoot) debugBoxRoot.dispose()

        debugBoxRoot = new BABYLON.TransformNode('debugBoxRoot', scene)
        debugBoxRoot.parent = bboxRoot
        debugBoxRoot.setEnabled(showObjectBoxes.value && guiSettings.value.bboxShowDebug)

        const platformY = guiSettings.value.bboxPlatformY
        const worldSize = guiSettings.value.bboxWorldSize
        const platformThickness = 0.25

        const platform = BABYLON.MeshBuilder.CreateBox('platform', { width: worldSize, depth: worldSize, height: platformThickness }, scene)
        platform.position.y = platformY
        platform.parent = debugBoxRoot
        const platformMat = new BABYLON.StandardMaterial('platformMat', scene)
        platformMat.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.8)
        platform.material = platformMat

        const mapSize = 1000
        const scaleFactor = worldSize / mapSize
        const offset = worldSize / 2
        const boxHeight = 3
        const boxCenterY = platformY + (platformThickness / 2) + (boxHeight / 2)

        const colors = [
            new BABYLON.Color3(1, 0, 0), new BABYLON.Color3(0, 1, 0), new BABYLON.Color3(0, 0, 1),
            new BABYLON.Color3(1, 1, 0), new BABYLON.Color3(0, 1, 1), new BABYLON.Color3(1, 0, 1),
            new BABYLON.Color3(1, 0.5, 0)
        ]
        let colorIdx = 0

        for (const key in data) {
            const item = data[key]
            if (!item.bounding_boxes) continue
            const color = colors[colorIdx % colors.length]
            const mat = new BABYLON.StandardMaterial('mat_' + key, scene)
            mat.diffuseColor = color
            mat.alpha = 0.6
            colorIdx++

            item.bounding_boxes.forEach((bbox, index) => {
                // Floor plan format: [ymin, xmin, ymax, xmax]
                const [ymin, xmin, ymax, xmax] = bbox
                const minX = xmin
                const minZ = ymin
                const maxX = xmax
                const maxZ = ymax
                const w = (maxX - minX) * scaleFactor
                const d = (maxZ - minZ) * scaleFactor
                const centerX = ((minX + maxX) / 2) * scaleFactor - offset
                const centerZ = offset - ((minZ + maxZ) / 2) * scaleFactor

                const box = BABYLON.MeshBuilder.CreateBox(key, { width: w, depth: d, height: boxHeight }, scene)
                box.position.set(centerX, boxCenterY, centerZ)
                box.material = mat
                box.parent = debugBoxRoot
            })
        }
    }

    // Computed list of objects for UI rendering
    const objectsList = ref([])
    
    function updateObjectsList() {
        if (!studioBoundingBoxes || !studioBoundingBoxes.value) {
            objectsList.value = []
            return
        }
        const data = studioBoundingBoxes.value
        const items = []
        for (const key in data) {
            const item = data[key]
            if (!item.bounding_boxes) continue
            item.bounding_boxes.forEach((bbox, index) => {
                const assignedUrl = getAssignedGlbUrl(key, index)
                items.push({
                    key,
                    index,
                    bbox,
                    label: key + (item.bounding_boxes.length > 1 ? ` (${index + 1})` : ''),
                    assignedUrl
                })
            })
        }
        objectsList.value = items
    }

    watch(() => studioBoundingBoxes && studioBoundingBoxes.value, () => updateObjectsList(), { deep: true })
    watch(() => studioGlbAssignments && studioGlbAssignments.value, () => updateObjectsList(), { deep: true })

    function handleObjectFileUpload(event, obj) {
        const file = event.target.files?.[0]
        if (!file) return
        handleGlbUploadForBBox(file, obj.bbox, obj.key, obj.index)
    }

    async function loadObjectGlb(obj) {
        const url = getAssignedGlbUrl(obj.key, obj.index)
        if (!url) return
        await loadGlbUrlForBBox(url, obj.bbox, obj.key, obj.index)
    }

    function clearObjectGlb(obj) {
        clearPlacedGlb(obj.key, obj.index)
        setAssignedGlbUrl(obj.key, obj.index, null)
        updateObjectsList()
    }

    function downloadObjectGlb(obj) {
        const url = obj.assignedUrl
        if (!url) return
        
        // Create a download link
        const link = document.createElement('a')
        link.href = url
        
        // Generate filename from object label
        const safeName = obj.label.replace(/[^a-z0-9]/gi, '_').toLowerCase()
        link.download = `${safeName}.glb`
        
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    function keyIndex(key, index) {
        return `${key}__${index}`
    }

    function getAssignedGlbUrl(key, index) {
        if (!studioGlbAssignments || !studioGlbAssignments.value) return null
        const arr = studioGlbAssignments.value[key]
        if (!Array.isArray(arr)) return null
        const item = arr[index]
        if (!item) return null
        // Handle both old string format and new object format
        return typeof item === 'string' ? item : item.glbUrl
    }

    function getAssignedImageUrl(key, index) {
        if (!studioGlbAssignments || !studioGlbAssignments.value) return null
        const arr = studioGlbAssignments.value[key]
        if (!Array.isArray(arr)) return null
        const item = arr[index]
        if (!item) return null
        // Handle new object format
        return typeof item === 'object' ? item.imageUrl : null
    }

    function setAssignedGlbUrl(key, index, url) {
        if (!studioGlbAssignments || !studioGlbAssignments.value) return
        if (!studioGlbAssignments.value[key]) studioGlbAssignments.value[key] = []
        // Preserve imageUrl if it exists
        const existing = studioGlbAssignments.value[key][index]
        const imageUrl = typeof existing === 'object' ? existing.imageUrl : null
        studioGlbAssignments.value[key][index] = imageUrl ? { glbUrl: url, imageUrl } : url
    }

    function clearPlacedGlb(key, index) {
        const k = keyIndex(key, index)
        const wrapper = placedByKeyIndex.get(k)
        if (wrapper) {
            placedByKeyIndex.delete(k)
            placedGLBs = placedGLBs.filter(w => w !== wrapper)
            try { wrapper.dispose() } catch { }
        }
    }

    function clearAllPlacedGLBs() {
        for (const w of placedGLBs) {
            try { w.dispose() } catch { }
        }
        placedGLBs = []
        placedByKeyIndex.clear()
    }

    async function loadAssignedGlbsIntoScene() {
        if (!studioBoundingBoxes || !studioBoundingBoxes.value) return
        const data = studioBoundingBoxes.value
        const promises = []
        for (const key of Object.keys(data || {})) {
            const boxes = data[key]?.bounding_boxes
            if (!Array.isArray(boxes)) continue
            for (let index = 0; index < boxes.length; index++) {
                const url = getAssignedGlbUrl(key, index)
                if (!url) continue
                const k = keyIndex(key, index)
                if (placedByKeyIndex.has(k)) continue
                promises.push(loadGlbUrlForBBox(url, boxes[index], key, index))
            }
        }
        await Promise.allSettled(promises)
    }

    function handleGlbUploadForBBox(file, bbox, key, index) {
        if (!file) return
        const blobUrl = URL.createObjectURL(file)
        BABYLON.SceneLoader.ImportMesh('', '', blobUrl, scene, function (meshes) {
            if (meshes.length === 0) return
            const root = meshes[0]

            const platformY = guiSettings.value.bboxPlatformY
            const worldSize = guiSettings.value.bboxWorldSize
            const mapSize = 1000
            const scaleFactor = worldSize / mapSize
            const offset = worldSize / 2
            const platformThickness = 0.25
            const boxHeight = 3

            const [ymin, xmin, ymax, xmax] = bbox
            const minX = xmin
            const minZ = ymin
            const maxX = xmax
            const maxZ = ymax
            const targetWidth = (maxX - minX) * scaleFactor
            const targetDepth = (maxZ - minZ) * scaleFactor
            const targetHeight = boxHeight
            const centerX = ((minX + maxX) / 2) * scaleFactor - offset
            const centerZ = offset - ((minZ + maxZ) / 2) * scaleFactor
            const targetBottomY = platformY + (platformThickness / 2)

            root.position = BABYLON.Vector3.Zero()
            root.rotation = BABYLON.Vector3.Zero()
            root.scaling = BABYLON.Vector3.One()
            root.isPickable = true
            root.getChildMeshes(false).forEach(child => { child.isPickable = true })

            const bounds = root.getHierarchyBoundingVectors()
            const size = bounds.max.subtract(bounds.min)
            const center = bounds.max.add(bounds.min).scale(0.5)

            // Use TransformNode wrapper (as in reference) and a pick-helper mesh for gizmo
            const wrapper = new BABYLON.TransformNode('wrap_' + key + '_' + index, scene)
            wrapper.position = new BABYLON.Vector3(centerX, targetBottomY, centerZ)
            wrapper.parent = glbRoot || bboxRoot
            wrapper.metadata = { isGLBWrapper: true }

            root.parent = wrapper
            root.metadata = root.metadata || {}
            root.metadata.wrapper = wrapper
            root.getChildMeshes(false).forEach(child => { child.metadata = child.metadata || {}; child.metadata.wrapper = wrapper })

            const isTargetXLong = targetWidth >= targetDepth
            const isMeshXLong = size.x >= size.z
            if (isTargetXLong !== isMeshXLong) wrapper.rotation.y = Math.PI / 2

            let effWidth = size.x
            let effDepth = size.z
            if (isTargetXLong !== isMeshXLong) { effWidth = size.z; effDepth = size.x }

            const sX = targetWidth / effWidth
            const sZ = targetDepth / effDepth
            const sY = targetHeight / size.y
            const baseScale = Math.min(sX, sZ, sY)
            const scaleMultiplier = guiSettings.value.glbScaleMult
            const finalScale = baseScale * scaleMultiplier
            wrapper.scaling = new BABYLON.Vector3(finalScale, finalScale, finalScale)

            root.position.x = -center.x
            root.position.z = -center.z
            root.position.y = -bounds.min.y

            const yOffset = guiSettings.value.glbYOffset
            wrapper.position.y += yOffset

            wrapper.metadata = { bbox, key, index, baseScale, bounds, center, isGLBWrapper: true }
            placedGLBs.push(wrapper)
            placedByKeyIndex.set(keyIndex(key, index), wrapper)

            // Create an invisible pick-helper attached to wrapper and add to attachableMeshes
            const pickHelper = BABYLON.MeshBuilder.CreateBox('pick_' + key + '_' + index, { width: targetWidth, height: 0.01, depth: targetDepth }, scene)
            pickHelper.visibility = 0
            pickHelper.isPickable = true
            pickHelper.position = new BABYLON.Vector3(0, 0, 0)
            pickHelper.parent = wrapper
            gizmoManager.attachableMeshes.push(pickHelper)

            root.getChildMeshes(false).forEach(m => { 
                if (shadowGenerator) { 
                    shadowGenerator.addShadowCaster(m)
                    m.receiveShadows = true 
                }
                if (roomLightShadowGen) {
                    roomLightShadowGen.addShadowCaster(m)
                }
                // Set material properties
                if (m.material) {
                    console.log('[Material Debug]', m.name, m.material)
                    console.log('  roughness before:', m.material.roughness, 'metallic before:', m.material.metallic)
                    if (m.material.roughness !== undefined) m.material.roughness = 1
                    if (m.material.metallic !== undefined) m.material.metallic = 0
                    console.log('  roughness after:', m.material.roughness, 'metallic after:', m.material.metallic)
                }
            })
        }, null, function () { }, '.glb')
    }

    async function loadGlbUrlForBBox(glbUrl, bbox, key, index) {
        if (!glbUrl) return
        // Clear existing placement for this key/index before re-loading
        clearPlacedGlb(key, index)

        return new Promise((resolve, reject) => {
            const useGltfPlugin = /\.(glb|gltf)(\?|$)/i.test(glbUrl)
            const importArgs = [ '', '', glbUrl, scene, function (meshes) {
                try {
                    if (!meshes || meshes.length === 0) return resolve()
                    const root = meshes[0]

                    const platformY = guiSettings.value.bboxPlatformY
                    const worldSize = guiSettings.value.bboxWorldSize
                    const mapSize = 1000
                    const scaleFactor = worldSize / mapSize
                    const offset = worldSize / 2
                    const platformThickness = 0.25
                    const boxHeight = 3

                    const [ymin, xmin, ymax, xmax] = bbox
                    const minX = xmin
                    const minZ = ymin
                    const maxX = xmax
                    const maxZ = ymax

                    const targetWidth = (maxX - minX) * scaleFactor
                    const targetDepth = (maxZ - minZ) * scaleFactor
                    const centerX = ((minX + maxX) / 2) * scaleFactor - offset
                    const centerZ = offset - ((minZ + maxZ) / 2) * scaleFactor
                    const targetBottomY = platformY + (platformThickness / 2)

                    root.position = BABYLON.Vector3.Zero()
                    root.rotation = BABYLON.Vector3.Zero()
                    root.scaling = BABYLON.Vector3.One()
                    root.isPickable = true
                    root.getChildMeshes(false).forEach(child => { child.isPickable = true })

                    const bounds = root.getHierarchyBoundingVectors()
                    const size = bounds.max.subtract(bounds.min)
                    const center = bounds.max.add(bounds.min).scale(0.5)

                    const wrapper = new BABYLON.TransformNode('wrap_' + key + '_' + index, scene)
                    wrapper.position = new BABYLON.Vector3(centerX, targetBottomY, centerZ)
                    wrapper.parent = glbRoot || bboxRoot
                    wrapper.metadata = { isGLBWrapper: true }

                    root.parent = wrapper
                    root.metadata = root.metadata || {}
                    root.metadata.wrapper = wrapper
                    root.getChildMeshes(false).forEach(child => { child.metadata = child.metadata || {}; child.metadata.wrapper = wrapper })

                    const isTargetXLong = targetWidth >= targetDepth
                    const isMeshXLong = size.x >= size.z
                    if (isTargetXLong !== isMeshXLong) wrapper.rotation.y = Math.PI / 2

                    let effWidth = size.x
                    let effDepth = size.z
                    if (isTargetXLong !== isMeshXLong) { effWidth = size.z; effDepth = size.x }

                    const sX = targetWidth / effWidth
                    const sZ = targetDepth / effDepth
                    const sY = boxHeight / size.y
                    const baseScale = Math.min(sX, sZ, sY)
                    const scaleMultiplier = guiSettings.value.glbScaleMult
                    const finalScale = baseScale * scaleMultiplier
                    wrapper.scaling = new BABYLON.Vector3(finalScale, finalScale, finalScale)

                    root.position.x = -center.x
                    root.position.z = -center.z
                    root.position.y = -bounds.min.y

                    const yOffset = guiSettings.value.glbYOffset
                    wrapper.position.y += yOffset

                    wrapper.metadata = { bbox, key, index, baseScale, bounds, center, isGLBWrapper: true }
                    placedGLBs.push(wrapper)
                    placedByKeyIndex.set(keyIndex(key, index), wrapper)

                    const pickHelper = BABYLON.MeshBuilder.CreateBox('pick_' + key + '_' + index, { width: targetWidth, height: 0.01, depth: targetDepth }, scene)
                    pickHelper.visibility = 0
                    pickHelper.isPickable = true
                    pickHelper.position = new BABYLON.Vector3(0, 0, 0)
                    pickHelper.parent = wrapper
                    gizmoManager.attachableMeshes.push(pickHelper)

                    root.getChildMeshes(false).forEach(m => { 
                        if (shadowGenerator) { 
                            shadowGenerator.addShadowCaster(m)
                            m.receiveShadows = true 
                        }
                        if (roomLightShadowGen) {
                            roomLightShadowGen.addShadowCaster(m)
                        }
                        // Set material properties
                        if (m.material) {
                            console.log('[Material Debug]', m.name, m.material)
                            console.log('  roughness before:', m.material.roughness, 'metallic before:', m.material.metallic)
                            if (m.material.roughness !== undefined) m.material.roughness = 1
                            if (m.material.metallic !== undefined) m.material.metallic = 0
                            console.log('  roughness after:', m.material.roughness, 'metallic after:', m.material.metallic)
                        }
                    })
                    resolve()
                } catch (e) {
                    reject(e)
                }
            }, null, function (_scene, message, exception) {
                reject(new Error(message || (exception && exception.message) || 'Failed to load GLB URL'))
            } ]
            if (useGltfPlugin) importArgs.push('.glb')
            BABYLON.SceneLoader.ImportMesh.apply(null, importArgs)
        })
    }

    function updateAllPlacedGLBs() {
        const scaleMultiplier = guiSettings.value.glbScaleMult
        const yOffset = guiSettings.value.glbYOffset
        const platformY = guiSettings.value.bboxPlatformY
        const platformThickness = 0.25
        const targetBottomY = platformY + (platformThickness / 2)
        placedGLBs.forEach(wrapper => {
            if (wrapper.metadata) {
                const { bbox, baseScale } = wrapper.metadata
                const worldSize = guiSettings.value.bboxWorldSize
                const mapSize = 1000
                const scaleFactor = worldSize / mapSize
                const offset = worldSize / 2
                const [minX, minZ, maxX, maxZ] = bbox
                const centerX = ((minX + maxX) / 2) * scaleFactor - offset
                const centerZ = offset - ((minZ + maxZ) / 2) * scaleFactor
                wrapper.position.x = centerX
                wrapper.position.y = targetBottomY + yOffset
                wrapper.position.z = centerZ
                const finalScale = baseScale * scaleMultiplier
                wrapper.scaling = new BABYLON.Vector3(finalScale, finalScale, finalScale)
            }
        })
    }
</script>

<template>
  <div class="h-full flex bg-gray-900">
    <!-- Left Sidebar - Split into two scrollable sections -->
    <div class="w-64 border-r border-gray-700 bg-gray-800 flex flex-col overflow-hidden">
      <!-- Top Half: Objects List & Add Object -->
      <div class="flex-1 overflow-y-auto border-b border-gray-700">
        <div class="p-4 space-y-4">
          <!-- Object List -->
          <div>
            <h3 class="text-sm font-semibold text-gray-300 mb-2">Object List</h3>
            <div class="space-y-2">
              <div
                v-for="obj in objectsList"
                :key="`${obj.key}_${obj.index}`"
                class="bg-gray-700 rounded p-2 text-xs relative group"
              >
                <div class="font-medium text-gray-200 mb-1">{{ obj.label }}</div>
                <div v-if="obj.assignedUrl" class="text-gray-400 mb-2 truncate text-xs" :title="obj.assignedUrl">
                  {{ obj.assignedUrl.split('/').pop() }}
                </div>
                <div class="flex gap-1">
                  <button
                    @click="() => $refs['fileInput_' + obj.key + '_' + obj.index][0].click()"
                    class="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center justify-center gap-1"
                  >
                    <span class="material-symbols-outlined text-sm">upload</span>
                    Replace
                  </button>
                  <button
                    v-if="obj.assignedUrl"
                    @click="downloadObjectGlb(obj)"
                    class="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs flex items-center justify-center"
                    title="Download GLB"
                  >
                    <span class="material-symbols-outlined text-sm">download</span>
                  </button>
                  <button
                    @click="clearObjectGlb(obj)"
                    class="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs flex items-center justify-center"
                    title="Delete"
                  >
                    <span class="material-symbols-outlined text-sm">delete</span>
                  </button>
                  <button
                    @click="duplicateObject(obj)"
                    class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs flex items-center justify-center"
                    title="Duplicate"
                  >
                    <span class="material-symbols-outlined text-sm">content_copy</span>
                  </button>
                </div>
                <input
                  :ref="'fileInput_' + obj.key + '_' + obj.index"
                  type="file"
                  accept=".glb,.gltf"
                  @change="(e) => handleObjectFileUpload(e, obj)"
                  class="hidden"
                />
              </div>
              <div v-if="objectsList.length === 0" class="bg-blue-900/30 border border-blue-600/50 rounded-lg p-4 text-center">
                <span class="material-symbols-outlined text-blue-400 text-2xl mb-2">view_in_ar</span>
                <p class="text-blue-300 text-xs font-medium mb-1">Want some 3D assets?</p>
                <p class="text-blue-400/70 text-xs">Use the <strong>Convert to 3D</strong> function in the Ideation tab to populate the scene!</p>
              </div>
            </div>
          </div>

          <!-- Add Object -->
          <div>
            <h3 class="text-sm font-semibold text-gray-300 mb-2">Add Object</h3>
            <div class="space-y-2">
              <label class="block">
                <input
                  type="file"
                  accept=".glb,.gltf"
                  multiple
                  @change="handleFileUpload"
                  ref="addObjectFileInput"
                  class="hidden"
                />
                <button
                  @click="$refs.addObjectFileInput.click()"
                  class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm flex items-center justify-center gap-2"
                >
                  <span class="material-symbols-outlined">upload_file</span>
                  Upload GLB
                </button>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Half: Scene Controls -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-4 space-y-4">
          <!-- Lighting -->
        <div>
          <h3 class="text-sm font-semibold text-gray-300 mb-2">Lighting</h3>
          <div class="space-y-2">
            <label class="flex items-center text-xs text-gray-300">
              <input
                type="checkbox"
                v-model="sunlightEnabled"
                class="mr-2 rounded bg-gray-700 border-gray-600"
              />
              Sunlight
            </label>
            
            <label class="flex items-center text-xs text-gray-300">
              <input
                type="checkbox"
                v-model="roomLightEnabled"
                class="mr-2 rounded bg-gray-700 border-gray-600"
              />
              Room Light
            </label>
            
            <div v-if="roomLightEnabled" class="pl-4 space-y-2 border-l-2 border-gray-600">
              <div>
                <label class="text-xs text-gray-400 block mb-1">Color</label>
                <input
                  type="color"
                  v-model="roomLightColor"
                  class="w-full h-6 rounded cursor-pointer"
                />
              </div>
              <div>
                <label class="text-xs text-gray-400 block mb-1">Intensity: {{ roomLightIntensity.toFixed(0) }}</label>
                <input
                  type="range"
                  v-model.number="roomLightIntensity"
                  min="0"
                  max="5000"
                  step="10"
                  class="w-full"
                />
              </div>
            </div>
            
            <div>
              <label class="text-xs text-gray-400 block mb-1">Ambient: {{ ambientIntensity.toFixed(2) }}</label>
              <input
                type="range"
                v-model.number="ambientIntensity"
                min="0"
                max="5"
                step="0.05"
                class="w-full"
              />
            </div>
          </div>
        </div>
        
        <!-- Controls -->
        <div>
          <h3 class="text-sm font-semibold text-gray-300 mb-2">Controls</h3>
          <div class="space-y-2">
            <label class="flex items-center text-xs text-gray-300">
              <input
                type="checkbox"
                v-model="ssaoEnabled"
                class="mr-2 rounded bg-gray-700 border-gray-600"
              />
              Enable SSAO
            </label>
            <label class="flex items-center text-xs text-gray-300">
              <input
                type="checkbox"
                v-model="showObjectBoxes"
                class="mr-2 rounded bg-gray-700 border-gray-600"
              />
              Show Object Boxes
            </label>
            <label class="flex items-center text-xs text-gray-300">
              <input
                type="checkbox"
                v-model="showFullRoom"
                class="mr-2 rounded bg-gray-700 border-gray-600"
              />
              Show Full Room
            </label>
          </div>
        </div>
        
        <!-- Room Structure -->
        <div>
          <h3 class="text-sm font-semibold text-gray-300 mb-2">Room Structure</h3>
          <select
            v-model="roomStructureMode"
            class="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded text-xs"
          >
            <option value="default">Use Default Room Structure</option>
            <option value="generated">Use Generated Room Structure</option>
          </select>
        </div>

        <!-- Actions -->
        <div class="space-y-2">
          <button
            @click="openInspector"
            class="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm flex items-center justify-center gap-2"
          >
            <span class="material-symbols-outlined">bug_report</span>
            Open Inspector
          </button>
          <button
            @click="toggleCamera"
            class="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm flex items-center justify-center gap-2"
          >
            <span class="material-symbols-outlined">{{ isFirstPersonCamera ? 'videocam' : 'panorama_photosphere' }}</span>
            {{ isFirstPersonCamera ? 'Switch to Arc Camera' : 'Switch to First-Person' }}
          </button>
          <div>
            <label class="block text-xs font-semibold text-gray-300 mb-1">Scene Background</label>
            <select
              v-model="sceneBackground"
              @change="applySceneBackground"
              class="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded text-sm"
            >
              <option value="Evening">Evening</option>
              <option value="Day">Day</option>
              <option value="Studio">Studio</option>
            </select>
          </div>
          <button
            @click="rotateRoom90Degrees"
            class="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm flex items-center justify-center gap-2"
          >
            <span class="material-symbols-outlined">rotate_90_degrees_ccw</span>
            Rotate Room 90°
          </button>
        </div>
        </div>
      </div>
    </div>

    <!-- Canvas Area -->
    <div class="flex-1 relative flex flex-col">
      <canvas ref="canvasRef" class="flex-1 w-full h-full"></canvas>
      
      <!-- Render with FIBO Button - Top Left -->
      <button
        @click="startRenderWithFIBO"
        class="absolute top-4 left-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-lg flex items-center gap-2 z-10"
      >
        <span class="material-symbols-outlined">photo_camera</span>
        FIBO Neural Render
      </button>
      
      <!-- Rendering Progress Indicator -->
      <div
        v-if="isRenderingWithFIBO"
        class="absolute top-4 left-4 px-4 py-2 bg-purple-900 bg-opacity-90 text-white rounded-lg shadow-lg flex items-center gap-2 z-10"
      >
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        Enhancing scene with FIBO...
      </div>
      
      <!-- Render Prompt Dialog -->
      <div
        v-if="showRenderPrompt"
        class="absolute inset-0 flex items-start justify-start pt-20 pl-4 z-20 pointer-events-none"
      >
        <div class="bg-black bg-opacity-80 backdrop-blur-sm rounded-lg p-4 w-80 shadow-xl pointer-events-auto">
          <p class="text-white text-sm mb-4">Adjust the camera to the viewpoint you want to render the scene from.</p>
          <div class="flex gap-2">
            <button
              @click="renderWithFIBO"
              class="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded flex items-center justify-center gap-2"
            >
              <span class="material-symbols-outlined text-sm">photo_camera</span>
              Render
            </button>
            <button
              @click="cancelRenderWithFIBO"
              class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      
      <!-- Render Results Dialog -->
      <div
        v-if="showRenderResults"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center pointer-events-auto z-[1000]"
        @click.self="closeRenderResults"
      >
        <div class="bg-gray-800 rounded-lg p-6 w-[900px] max-w-full space-y-4">
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold text-gray-100">FIBO Enhanced Renders</h3>
            <button
              @click="closeRenderResults"
              class="text-gray-400 hover:text-gray-200"
            >
              ✕
            </button>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div
              v-for="result in fiboRenderResults"
              :key="result.id"
              class="space-y-2"
            >
              <div class="bg-gray-700 rounded p-2">
                <img :src="result.imageUrl" alt="FIBO Render" class="w-full h-auto rounded" />
              </div>
              <button
                @click="downloadRenderResult(result.imageUrl, result.id)"
                class="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined text-sm">download</span>
                Download Option {{ result.id }}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Gizmo UI Overlay -->
      <div
        v-if="gizmoUIPosition.visible"
        :style="{
          position: 'absolute',
          left: gizmoUIPosition.x + 'px',
          top: gizmoUIPosition.y + 'px',
          transform: 'translateY(-50%)'
        }"
        class="flex flex-col gap-1 pointer-events-auto"
      >
        <button
          @click="rotateSelectedObject90"
          class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs shadow-lg whitespace-nowrap flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">rotate_90_degrees_ccw</span>
          Rotate 90°
        </button>
        <button
          @click="resetSelectedObjectRotation"
          class="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs shadow-lg whitespace-nowrap flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">refresh</span>
          Reset Rotation
        </button>
        <div class="bg-gray-800 rounded px-3 py-2 shadow-lg">
          <label class="text-xs text-gray-300 block mb-1">Scale</label>
          <input
            type="range"
            v-model.number="selectedObjectScaleMultiplier"
            @input="updateSelectedObjectScale"
            min="0.1"
            max="3.0"
            step="0.1"
            class="w-32"
          />
          <span class="text-xs text-gray-400 ml-2">{{ selectedObjectScaleMultiplier.toFixed(1) }}</span>
        </div>
        <button
          @click="resetSelectedObjectScale"
          class="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs shadow-lg whitespace-nowrap flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">aspect_ratio</span>
          Reset Scale
        </button>
        <button
          @click="openEditDialog"
          class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs shadow-lg whitespace-nowrap flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">edit</span>
          Edit Object
        </button>
        <button
          @click="duplicateSelectedObject"
          class="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs shadow-lg whitespace-nowrap flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">content_copy</span>
          Duplicate
        </button>
      </div>
      
      <!-- Edit Object Dialog -->
      <div
        v-if="showEditDialog"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center pointer-events-auto z-[1000]"
        @click.self="closeEditDialog"
      >
        <div class="bg-gray-800 rounded-lg p-6 w-[800px] max-w-full space-y-4">
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold text-gray-100">Edit Object</h3>
            <button
              @click="closeEditDialog"
              class="text-gray-400 hover:text-gray-200"
            >
              ✕
            </button>
          </div>
          
          <p class="text-xs text-gray-400">Image will be edited by Bria FIBO image model and 3D model will be regenerated with Trellis 3D on fal.ai</p>
          
          <div class="flex gap-4">
            <!-- Left: Image with Before/After Toggle -->
            <div class="flex-1 flex flex-col">
              <!-- Before/After Toggle (only show when edited image exists) -->
              <div v-if="editedImage" class="flex justify-center mb-2">
                <div class="inline-flex bg-gray-700 rounded p-1">
                  <button 
                    @click="showEditBefore = false"
                    :class="[
                      'px-3 py-1 text-xs font-semibold rounded transition-colors',
                      !showEditBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    ]"
                  >
                    After
                  </button>
                  <button 
                    @click="showEditBefore = true"
                    :class="[
                      'px-3 py-1 text-xs font-semibold rounded transition-colors',
                      showEditBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    ]"
                  >
                    Before
                  </button>
                </div>
              </div>
              
              <p v-if="!editedImage" class="text-xs text-gray-400 mb-2">Source Image:</p>
              
              <!-- Image Display -->
              <div class="bg-gray-700 rounded p-2 flex-1 flex items-center justify-center">
                <Transition name="fade" mode="out-in">
                  <img 
                    v-if="editedImage && !showEditBefore"
                    :key="'after'"
                    :src="editedImage" 
                    alt="Edited result" 
                    class="w-full h-auto rounded" 
                  />
                  <img 
                    v-else-if="editDialogImage"
                    :key="'before'"
                    :src="editDialogImage" 
                    alt="Object source" 
                    class="w-full h-auto rounded" 
                  />
                  <div v-else class="text-gray-500 text-sm">No image available</div>
                </Transition>
              </div>
              
              <!-- Accept/Reject Buttons (only show when edited image exists) -->
              <div v-if="editedImage" class="flex gap-2 mt-3">
                <button
                  @click="acceptEdit"
                  :disabled="isRegenerating3D"
                  class="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded flex items-center justify-center gap-2"
                >
                  <div v-if="isRegenerating3D" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {{ isRegenerating3D ? 'Regenerating 3D...' : 'Accept' }}
                </button>
                <button
                  @click="rejectEdit"
                  :disabled="isRegenerating3D"
                  class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded"
                >
                  Reject
                </button>
              </div>
            </div>
            
            <!-- Right: Textbox -->
            <div class="flex-1 flex flex-col">
              <label class="text-sm text-gray-300 block mb-2">Edit Prompt</label>
              <textarea
                v-model="editDialogText"
                class="flex-1 bg-gray-700 text-gray-100 rounded p-2 text-sm resize-none"
                placeholder="Describe how you want to edit this object..."
              ></textarea>
            </div>
          </div>
          
          <!-- Action Buttons -->
          <div v-if="!editedImage" class="flex gap-2">
            <button
              @click="applyEdit"
              :disabled="!editDialogImage || !editDialogText.trim() || isEditingImage"
              class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded flex items-center justify-center gap-2"
            >
              <div v-if="isEditingImage" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              {{ isEditingImage ? 'Editing with FIBO...' : 'Apply Edit' }}
            </button>
            <button
              @click="closeEditDialog"
              class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      
      <!-- Controls Pane at Bottom -->
      <div class="bg-gray-800 border-t border-gray-700 px-4 py-2">
        <div class="flex items-center justify-center gap-6 text-xs text-gray-400">
          <div class="flex items-center gap-2">
            <kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Middle Click + Drag</kbd>
            <span>Rotate</span>
          </div>
          <div class="flex items-center gap-2">
            <kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Right Click + Drag</kbd>
            <span>Pan</span>
          </div>
          <div class="flex items-center gap-2">
            <kbd class="px-2 py-1 bg-gray-700 rounded text-gray-300">Scroll</kbd>
            <span>Zoom</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* No custom CSS - all Tailwind */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>