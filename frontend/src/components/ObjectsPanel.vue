<script setup>
import { ref, inject } from 'vue'
import { prompts } from '../prompts'
import { generateImage, analyzeImage, generate3DModel, detectBoundingBoxes, fetchOpenGraph } from '../api'

const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const currentImage = inject('currentImage')
const isGenerating = inject('isGenerating')
const pendingImage = inject('pendingImage')
const pendingPrompt = inject('pendingPrompt')
const pendingSeed = inject('pendingSeed')
const addActivity = inject('addActivity')
const fileToBase64 = inject('fileToBase64')
const glbList = inject('glbList')
const activeTab = inject('activeTab', null)
const studioBoundingBoxes = inject('studioBoundingBoxes', null)
const studioGlbAssignments = inject('studioGlbAssignments', null)
const userQuota = inject('userQuota')
const removeObjectsByDescription = inject('removeObjectsByDescription')

const selectedObjects = ref([])
const showAddDialog = ref(false)
const isConverting = ref(false)
const addMode = ref('upload') // 'upload', 'describe', or 'link'
const addObjectImage = ref(null)
const addObjectFile = ref(null)
const addObjectName = ref('')
const addObjectDescription = ref(null)
const addTextDescription = ref('')
const addLinkUrl = ref('')
const linkMetadata = ref(null)
const isFetchingLink = ref(false)
const isAnalyzing = ref(false)
const isAdding = ref(false)
const showDeleteConfirm = ref(false)
const showEditDialog = ref(false)
const editObjectIndex = ref(null)
const editObjectData = ref(null)
const isApplyingEdit = ref(false)
const showGroupResults = ref(false)
const groupResults = ref([])
const lastGroupingData = ref(null)
const isGenerating3DAssets = ref(false)
const generating3DStatus = ref('')
const convertingStatus = ref('')
const isGeneratingFloorPlan = ref(false)
const importFileInput = ref(null)
const floorPlanGroups = ref(null)
const showBoundingBoxes = ref(false)
const boundingBoxResults = ref({})

const handleAddObject = () => {
  showAddDialog.value = true
}

// Scene Export/Import
const exportScene = () => {
  if (!structuredPrompt.value) {
    alert('No scene data to export')
    return
  }
  const data = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    structuredPrompt: structuredPrompt.value,
    seed: currentSeed.value,
    imageUrl: currentImage.value,
    furnitureList: null
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `3d-studio-scene-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const triggerImportScene = () => {
  importFileInput.value?.click()
}

const importScene = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result)
      if (!data.version || !data.structuredPrompt) {
        throw new Error('Invalid scene file format')
      }
      structuredPrompt.value = data.structuredPrompt
      currentSeed.value = data.seed
      currentImage.value = data.imageUrl
      // optional furnitureList restore if provided
      // furnitureList is provided at App level via IdeationTab
      // we attempt to inject if available
      try {
        const maybeFurniture = inject('furnitureList')
        if (maybeFurniture && data.furnitureList) {
          maybeFurniture.value = data.furnitureList
        }
      } catch {}
      alert('Scene imported successfully!')
    } catch (err) {
      alert('Error importing scene: ' + err.message)
    } finally {
      // reset input to allow re-import of same file
      event.target.value = ''
    }
  }
  reader.readAsText(file)
}

const handleImageUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    addObjectFile.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      addObjectImage.value = e.target.result
    }
    reader.readAsDataURL(file)
  }
}

const fetchLinkMetadata = async () => {
  if (!addLinkUrl.value.trim()) {
    alert('Please enter a URL')
    return
  }
  
  isFetchingLink.value = true
  linkMetadata.value = null
  
  try {
    const response = await fetch('http://localhost:3001/api/fetch-opengraph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: addLinkUrl.value })
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch link metadata')
    }
    
    // Store metadata
    linkMetadata.value = {
      title: data.title || 'Untitled',
      description: data.description || '',
      imageBase64: data.imageBase64,
      normalizedUrl: data.normalizedUrl
    }
    
    // If we have an image, display it
    if (data.imageBase64) {
      addObjectImage.value = `data:image/jpeg;base64,${data.imageBase64}`
    }
    
    // Pre-populate object name with title
    addObjectName.value = data.title || ''
    
    // Now analyze the image with Gemini to get a detailed description
    if (data.imageBase64) {
      isAnalyzing.value = true
      try {
        const analysisPrompt = `Focus on the main product/object in this image. Describe the product in detail, including its appearance, materials, colors, style, and any notable features. Keep it to 5 sentences as a product description.`
        
        const analysisData = await analyzeImage({
          prompt: analysisPrompt,
          imageBase64: data.imageBase64,
          mimeType: 'image/jpeg'
        })
        
        addObjectDescription.value = analysisData.text
      } catch (error) {
        console.error('Image analysis error:', error)
        // Fallback to og:description if analysis fails
        addObjectDescription.value = data.description || ''
      } finally {
        isAnalyzing.value = false
      }
    } else if (data.description) {
      // No image but we have og:description, use it as fallback
      addObjectDescription.value = data.description
    }
    
  } catch (error) {
    console.error('Link fetch error:', error)
    alert(error.message || 'Error fetching link metadata. Link may not be supported.')
  } finally {
    isFetchingLink.value = false
  }
}

const analyzeObject = async () => {
  if (!addObjectName.value.trim()) return
  
  isAnalyzing.value = true
  try {
    const base64Image = await fileToBase64(addObjectFile.value)
    const mimeType = addObjectFile.value.type
    const prompt = `Focus on the ${addObjectName.value}. Describe it in detail, including its appearance, materials, colors, style, and any notable features. Be specific and detailed.`

    const data = await analyzeImage(base64Image, mimeType, prompt)
    addObjectDescription.value = data.candidates[0].content.parts[0].text
  } catch (error) {
    console.error('Analysis error:', error)
    alert('Error analyzing object: ' + error.message)
  } finally {
    isAnalyzing.value = false
  }
}

const confirmAdd = async () => {
  isAdding.value = true
  try {
    const addPrompt = prompts.addObject({ name: addObjectName.value, description: addObjectDescription.value })

    const data = await generateImage({
      structuredPrompt: structuredPrompt.value,
      prompt: addPrompt,
      seed: currentSeed.value
    })

    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed

    // Set activity description for ContentArea
    window._pendingActivityDescription = `Added object: ${addObjectName.value}`
    window._pendingActivityType = 'add'

    // Close dialog
    showAddDialog.value = false
    addObjectImage.value = null
    addObjectFile.value = null
    addObjectName.value = ''
    addObjectDescription.value = null
  } catch (error) {
    console.error('Add error:', error)
    alert('Error adding object: ' + error.message)
  } finally {
    isAdding.value = false
  }
}

const confirmAddText = async () => {
  if (!addTextDescription.value.trim()) return
  
  isAdding.value = true
  try {
    const addPrompt = prompts.addObjectText({ description: addTextDescription.value })

    const data = await generateImage({
      structured_prompt: JSON.stringify(structuredPrompt.value),
      prompt: addPrompt,
      seed: currentSeed.value
    })

    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed

    // Set activity description for ContentArea
    window._pendingActivityDescription = `Added: ${addTextDescription.value}`
    window._pendingActivityType = 'add'

    // Close dialog
    showAddDialog.value = false
    addTextDescription.value = ''
  } catch (error) {
    console.error('Add error:', error)
    alert('Error adding object: ' + error.message)
  } finally {
    isAdding.value = false
  }
}

const cancelAdd = () => {
  showAddDialog.value = false
  addMode.value = 'upload'
  addObjectImage.value = null
  addObjectFile.value = null
  addObjectName.value = ''
  addObjectDescription.value = null
  addTextDescription.value = ''
  addLinkUrl.value = ''
  linkMetadata.value = null
}

const handleDelete = () => {
  if (selectedObjects.value.length === 0) return
  showDeleteConfirm.value = true
}

const confirmDelete = async () => {
  showDeleteConfirm.value = false
  try {
    const descriptions = selectedObjects.value.map(idx => structuredPrompt.value.objects[idx].description)
    await removeObjectsByDescription(descriptions)
    selectedObjects.value = []
  } catch (error) {
    console.error('Delete error:', error)
    alert('Error removing objects: ' + error.message)
  }
}

const cancelDelete = () => {
  showDeleteConfirm.value = false
}

const handleEdit = (index) => {
  editObjectIndex.value = index
  editObjectData.value = JSON.parse(JSON.stringify(structuredPrompt.value.objects[index]))
  showEditDialog.value = true
}

const deleteObject = async (index) => {
  if (!confirm(`Delete Object ${index + 1}?`)) return
  
  try {
    const description = structuredPrompt.value.objects[index].description
    
    // Remove from selected objects if it was selected
    const indexInSelected = selectedObjects.value.indexOf(index)
    if (indexInSelected > -1) {
      selectedObjects.value.splice(indexInSelected, 1)
    }
    
    // Adjust selected object indices (shift down all indices > deleted index)
    selectedObjects.value = selectedObjects.value.map(i => i > index ? i - 1 : i)
    
    await removeObjectsByDescription([description])
    window._pendingActivityType = 'remove'
  } catch (error) {
    console.error('Delete object error:', error)
    alert('Error deleting object: ' + error.message)
  }
}

const cancelEdit = () => {
  showEditDialog.value = false
  editObjectIndex.value = null
  editObjectData.value = null
}

const applyEdit = async () => {
  if (editObjectIndex.value == null || !editObjectData.value) return
  isApplyingEdit.value = true
  try {
    const updated = JSON.parse(JSON.stringify(structuredPrompt.value))
    updated.objects[editObjectIndex.value] = JSON.parse(JSON.stringify(editObjectData.value))

    const data = await generateImage({
      structured_prompt: JSON.stringify(updated),
      seed: currentSeed.value
    })

    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed

    // If there is no current image yet (e.g. imported scene without image),
    // apply the edit directly so the user immediately sees the result.
    if (!currentImage.value) {
      structuredPrompt.value = newStructuredPrompt
      currentSeed.value = newSeed
      currentImage.value = newImageUrl
      pendingImage.value = null
      pendingPrompt.value = null
      pendingSeed.value = null
      addActivity('edit', `Edited object: ${editObjectData.value.description}`)
    } else {
      // Otherwise, go through the normal pending flow so the user can accept/reject.
      pendingImage.value = newImageUrl
      pendingPrompt.value = newStructuredPrompt
      pendingSeed.value = newSeed
      
      // Set activity description for ContentArea
      window._pendingActivityDescription = `Edited object: ${editObjectData.value.description}`
      window._pendingActivityType = 'edit'
    }

    showEditDialog.value = false
    editObjectIndex.value = null
    editObjectData.value = null
  } catch (error) {
    console.error('Edit error:', error)
    alert('Error editing object: ' + error.message)
  } finally {
    isApplyingEdit.value = false
  }
}

const printStructuredPrompt = () => {
  if (!structuredPrompt.value) {
    console.log('No structured prompt available')
    return
  }
  console.log('Structured Prompt:', structuredPrompt.value)
}

// Extracted grouping function for reuse
const analyzeAndGroupObjects = async () => {
  const objectsList = structuredPrompt.value.objects
    .map((obj, idx) => `{"id": "obj_${idx}", "description": "${obj.description.replace(/"/g, '\\"')}"}`)
    .join(',\n  ')

  const groupingPrompt = `You are analyzing an interior design scene to group objects for 3D conversion. 

Scene context:
${structuredPrompt.value.short_description}

Objects in the scene:
[
  ${objectsList}
]

Your task: Group these objects intelligently for 3D rendering. Think carefully about:
1. Which objects are integrated into the room structure (walls, floors, built-in cabinets, etc.) - these form the "room" group
2. Which freestanding objects should be grouped (e.g., bed + pillows, table + items on table)
3. Avoid grouping unrelated objects (e.g., don't group a chair with a table unless they're clearly meant as a set)
4. If an object has multiple discrete instances (like "two nightstands"), keep them together in one group and SET quantity to the number of instances.
5. Avoid grouping functionally related but discrete objects (e.g. a bed and nightstands are DISCRETE OBJECTS!)
6. Do not group freestanding furniture into the room group. Only furniture INTEGRATED INTO THE WALLS such as an integrated cabinet are into the room group. But a freestanding chest of drawers IS NOT!
7. If an object is on top of another one (e.g. lamp on nightstand, TV on drawers) group them.
8. The quantity field represents how many instances of this furniture group exist in the scene.

Provide your response ONLY as a valid JSON object in this exact format:
{
  "reasoning": "Your 1-sentence analysis of the grouping decisions",
  "groups": [
    {
      "id": "room_structure",
      "type": "room",
      "name": "Room Structure",
      "object_ids": ["obj_0"],
      "rationale": "Brief explanation of why these objects belong together",
      "quantity": 1
    },
    {
      "id": "group_1",
      "type": "freestanding",
      "name": "Descriptive name for this group",
      "object_ids": ["obj_1", "obj_2"],
      "rationale": "Brief explanation",
      "quantity": 2
    }
  ]
}`;

  // Use backend API instead of direct Gemini call
  const groupingData = await analyzeImage({ prompt: groupingPrompt, model: 'gemini-2.5-flash', json: true })
  return groupingData
}

const findFirstUrlWithExtensions = (value, extensions) => {
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

const generateFloorPlanBoundingBoxesForGrouping = async (groupingData) => {
  if (!currentImage.value) throw new Error('No current image available for floor plan generation')
  if (!groupingData?.groups?.length) throw new Error('No grouping data available for floor plan generation')

  const groupList = groupingData.groups
    .map(g => `${g.name} (quantity: ${g.quantity || 1})`)
    .join('\n');

  const prompt = `Return bounding boxes as JSON arrays [ymin, xmin, ymax, xmax]

You are given a picture of a room taken from an angle. First, spatially project it such that you are now looking at it top-down. You are then given a canvas of 1000 by 1000, onto which you will draw the floor plan for it. The floor plan must have bounding boxes for:

${groupList}

For each furniture group, provide precise bounding boxes representing the footprint when viewed top-down. Each group should have as many bounding boxes as its quantity indicates. If you feel that there are more furniture in the room than the quantity for its group, select the most prominent / biggest ones first. Use the coordinate system [ymin, xmin, ymax, xmax] normalized to [0, 1000].

Return your response as a JSON object with this exact structure:
{
  "Group Name 1": {
    "bounding_boxes": [[ymin, xmin, ymax, xmax], [ymin, xmin, ymax, xmax], ...]
  },
  "Group Name 2": {
    "bounding_boxes": [[ymin, xmin, ymax, xmax]]
  }
}

Example:
{
  "Bed": {
    "bounding_boxes": [[205, 302, 458, 601]]
  },
  "Nightstands": {
    "bounding_boxes": [[220, 155, 350, 280], [220, 625, 350, 750]]
  },
  "Dresser": {
    "bounding_boxes": [[100, 400, 250, 650]]
  }
}`

  // Use backend API instead of direct Gemini call with image
  const bboxData = await detectBoundingBoxes({ prompt, imageUrl: currentImage.value })
  return bboxData
}

const generateTrellisModelFromImageUrl = async (imageUrl) => {
  if (!imageUrl) throw new Error('Missing image URL')

  // Use backend API instead of direct FAL call
  const data = await generate3DModel({ imageUrl })
  const url = data?.modelUrl || findFirstUrlWithExtensions(data, ['.glb', '.gltf', '.obj'])
  if (!url) {
    console.error('3D model response (no model url found):', data)
    throw new Error('3D generation succeeded but no model URL was found in response')
  }
  return url
}


const convertTo3D = async () => {
  if (!structuredPrompt.value) {
    alert('No scene to convert')
    return
  }

  isConverting.value = true
  groupResults.value = []
  convertingStatus.value = 'Analyzing scene and grouping objects...'

  try {
    // Step 1: Call Gemini to analyze and group objects
    const groupingData = await analyzeAndGroupObjects()
    lastGroupingData.value = groupingData

    // Step 2: Process all groups in parallel
    convertingStatus.value = `Rendering ${groupingData.groups.length} groups in parallel...`

    const groupPromises = groupingData.groups.map(async (group) => {
      // Get object descriptions for this group
      const groupObjectDescriptions = group.object_ids
        .map(id => {
          const idx = parseInt(id.replace('obj_', ''))
          return structuredPrompt.value.objects[idx]?.description || ''
        })
        .filter(desc => desc)
        .join('\n- ')

      let fiboPrompt
      if (group.type === 'room') {
        // Room structure prompt
        fiboPrompt = `First, remove all objects not in the below list. Preserve the appearance of the walls and floors. Then, strictly render this scene from a 45-degree angle, isometric view, inside-corner view, against a white background. Hence only the floor and 2 walls will be shown in the camera view, forming a corner. This camera angle is extremely important and must be strongly adhered to. Imagine you are standing slightly outside this room in a white space, looking directly into one of the corners. The corner itself should be the central focal point of the render. DO NOT show an outside corner (like looking at the corner of a building from the street). DO NOT show any ceiling. Make the walls shorter in height and thinner in thickness. Strip and remove all references to objects not mentioned below, from the scene description. Objects:\n\n- ${groupObjectDescriptions}`
      } else {
        // Freestanding objects prompt
        fiboPrompt = `Intelligently edit the scene to keep only the following object(s). If one of the objects given to you has multiple discrete instances, such as two identical nightstands, YOU MUST EDIT THE SCENE TO KEEP ONLY ONE INSTANCE. You need to isolate the specified objects from the rest of the scene and render them on a clean, white background from a 45-degree angle without any other objects from the scene or backgrounds. You need to untangle the specified objects from the rest of the scene in your response. Objects:\n\n- ${groupObjectDescriptions}`
      }

      try {
        // Call backend API to generate image
        const fiboData = await generateImage({
          structuredPrompt: structuredPrompt.value,
          prompt: fiboPrompt,
          seed: currentSeed.value
        })

        return {
          id: group.id,
          name: group.name,
          type: group.type,
          rationale: group.rationale,
          imageUrl: fiboData.imageUrl,
          objectIds: group.object_ids
        }
      } catch (error) {
        console.error(`Error rendering group ${group.name}:`, error)
        return null
      }
    })

    const results = await Promise.all(groupPromises)
    groupResults.value = results.filter(result => result !== null)

    // Show results dialog
    showGroupResults.value = true
  } catch (error) {
    console.error('Convert to 3D error:', error)
    alert('Error converting scene to 3D: ' + error.message)
  } finally {
    isConverting.value = false
    convertingStatus.value = ''
  }
}

const confirmConvertTo3DAndOpenStudio = async () => {
  if (isGenerating3DAssets.value) return
  if (!lastGroupingData.value) {
    alert('No grouping data available. Run Convert Scene to 3D first.')
    return
  }
  if (!groupResults.value?.length) {
    alert('No rendered group images available. Run Convert Scene to 3D first.')
    return
  }
  if (!studioBoundingBoxes || !studioGlbAssignments) {
    alert('3D Studio shared state is not available.')
    return
  }

  isGenerating3DAssets.value = true
  generating3DStatus.value = 'Generating floor plan bounding boxes...'
  try {
    const bboxData = await generateFloorPlanBoundingBoxesForGrouping(lastGroupingData.value)

    generating3DStatus.value = `Generating ${groupResults.value.length} 3D model(s) in parallel...`
    const glbPairs = await Promise.all(groupResults.value.map(async (group) => {
      const url = await generateTrellisModelFromImageUrl(group.imageUrl)
      return [group.name, url, group.imageUrl]
    }))

    const assignments = {}
    for (const [groupName, glbUrl, imageUrl] of glbPairs) {
      const boxes = bboxData?.[groupName]?.bounding_boxes
      const count = Array.isArray(boxes) ? boxes.length : 0
      assignments[groupName] = Array.from({ length: count }, () => ({ glbUrl, imageUrl }))
    }

    studioBoundingBoxes.value = bboxData
    studioGlbAssignments.value = assignments

    // Also keep the debug dialog data in sync for user inspection
    boundingBoxResults.value = bboxData

    if (activeTab && activeTab.value) activeTab.value = 'studio'
    showGroupResults.value = false
  } catch (error) {
    console.error('Confirm convert-to-3D error:', error)
    alert('Error converting to 3D: ' + error.message)
  } finally {
    isGenerating3DAssets.value = false
    generating3DStatus.value = ''
  }
}

const closeGroupResults = () => {
  showGroupResults.value = false
}

const generateFloorPlan = async () => {
  if (!structuredPrompt.value || !currentImage.value) {
    alert('No scene or image available for floor plan generation')
    return
  }

  isGeneratingFloorPlan.value = true
  try {
    // Step 1: Analyze and group objects
    const groupingData = await analyzeAndGroupObjects()
    floorPlanGroups.value = groupingData
    
    // Step 2: Build group list for prompt
    const groupList = groupingData.groups
      .map(g => `${g.name} (quantity: ${g.quantity || 1})`)
      .join('\n')
    
    // Step 3: Construct prompt with spatial projection instructions
    const prompt = `Return bounding boxes as JSON arrays [ymin, xmin, ymax, xmax]

You are given a picture of a room taken from an angle. First, spatially project it such that you are now looking at it top-down. You are then given a canvas of 1000 by 1000, onto which you will draw the floor plan for it. The floor plan must have bounding boxes for:

${groupList}

For each furniture group, provide precise bounding boxes representing the footprint when viewed top-down. Each group should have as many bounding boxes as its quantity indicates. Use the coordinate system [ymin, xmin, ymax, xmax] normalized to [0, 1000].

Return your response as a JSON object with this exact structure:
{
  "Group Name 1": {
    "bounding_boxes": [[ymin, xmin, ymax, xmax], [ymin, xmin, ymax, xmax], ...]
  },
  "Group Name 2": {
    "bounding_boxes": [[ymin, xmin, ymax, xmax]]
  }
}

Example:
{
  "Bed": {
    "bounding_boxes": [[205, 302, 458, 601]]
  },
  "Nightstands": {
    "bounding_boxes": [[220, 155, 350, 280], [220, 625, 350, 750]]
  },
  "Dresser": {
    "bounding_boxes": [[100, 400, 250, 650]]
  }
}`

    // Use backend API instead of direct Gemini call
    boundingBoxResults.value = await detectBoundingBoxes({ prompt, imageUrl: currentImage.value })
    
    console.log('Floor plan bounding boxes:', boundingBoxResults.value)
    
    // Show bounding box visualization
    showBoundingBoxes.value = true
  } catch (error) {
    console.error('Floor plan generation error:', error)
    alert('Error generating floor plan: ' + error.message)
  } finally {
    isGeneratingFloorPlan.value = false
  }
}



const closeBoundingBoxes = () => {
  showBoundingBoxes.value = false
}



// Helper function for consistent colors
const groupColors = {}
const colorPalette = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
let colorIndex = 0

const getColorForGroup = (groupName) => {
  if (!groupColors[groupName]) {
    groupColors[groupName] = colorPalette[colorIndex % colorPalette.length]
    colorIndex++
  }
  return groupColors[groupName]
}

// Canvas drawing for bounding boxes
import BoundingBoxesDialog from './BoundingBoxesDialog.vue'

</script>

<template>
  <div class="h-full flex flex-col bg-gray-800">
    <!-- Full-screen overlay during Convert to 3D -->
    <Transition name="fade">
      <div v-if="isConverting" class="fixed inset-0 z-[1000] bg-black bg-opacity-70 flex items-center justify-center">
        <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md text-center shadow-xl">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-3"></div>
          <div class="text-sm font-semibold mb-2">Rendering individual furniture pieces...</div>
          <div class="text-xs text-gray-400 whitespace-pre-line">Powered by Bria FIBO's controllable image generation</div>
        </div>
      </div>
    </Transition>
    <div class="p-3 border-b border-gray-700">
      <h2 class="text-sm font-semibold mb-3">Objects</h2>
      <div class="flex gap-2">
        <button 
          @click="handleAddObject"
          :disabled="!structuredPrompt"
          class="flex-1 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">add_circle</span>
          Add Object
        </button>
        <button 
          @click="handleDelete"
          :disabled="selectedObjects.length === 0"
          class="flex-1 px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
          Delete
        </button>
      </div>
      <div class="flex gap-2 mt-2">
        <button 
          @click="triggerImportScene"
          class="flex-1 px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">upload_file</span>
          Import Scene
        </button>
        <button 
          @click="exportScene"
          :disabled="!structuredPrompt"
          class="flex-1 px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-1"
        >
          <span class="material-symbols-outlined" style="font-size: 16px;">download</span>
          Export Scene
        </button>
        <input 
          ref="importFileInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="importScene"
        />
      </div>
      <button 
        @click="convertTo3D"
        :disabled="!structuredPrompt || isConverting"
        class="w-full mt-2 px-3 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-2"
      >
        <span class="material-symbols-outlined" style="font-size: 16px;">view_in_ar</span>
        <div v-if="isConverting" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
        <span v-if="isConverting">{{ convertingStatus || 'Converting scene...' }}</span>
        <span v-else>Convert Scene to 3D</span>
      </button>
      <button 
        @click="generateFloorPlan"
        :disabled="!structuredPrompt || !currentImage || isGeneratingFloorPlan"
        class="w-full mt-2 px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-2"
      >
        <span v-if="!isGeneratingFloorPlan" class="material-symbols-outlined" style="font-size: 16px;">auto_awesome</span>
        <div v-if="isGeneratingFloorPlan" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
        {{ isGeneratingFloorPlan ? 'Generating...' : 'Generate Floor Plan' }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <div v-if="!structuredPrompt" class="text-gray-500 text-xs text-center py-8">
        No objects yet
      </div>
      <div v-else class="space-y-1.5">
        <div 
          v-for="(obj, idx) in structuredPrompt.objects" 
          :key="idx"
          class="flex items-start gap-1.5 p-1.5 bg-gray-700 rounded hover:bg-gray-600"
        >
          <input 
            type="checkbox" 
            :value="idx"
            v-model="selectedObjects"
            class="mt-0.5 cursor-pointer flex-shrink-0"
          />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold text-gray-300">Object {{ idx + 1 }}</div>
            <div class="text-xs text-gray-400 line-clamp-3 mt-0.5 leading-tight">{{ obj.description }}</div>
          </div>
          <div class="flex flex-col gap-1 flex-shrink-0">
            <button 
              @click="handleEdit(idx)"
              class="p-1 text-xs bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center"
              title="Edit object"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;">edit</span>
            </button>
            <button 
              @click="deleteObject(idx)"
              class="p-1 text-xs bg-red-600 hover:bg-red-700 rounded flex items-center justify-center"
              title="Delete object"
            >
              <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Object Dialog -->
    <Transition name="fade">
      <div v-if="showAddDialog" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]" @click.self="cancelAdd">
        <Transition name="scale">
          <div v-if="showAddDialog" class="bg-gray-800 rounded-lg w-full max-w-md mx-4 p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold">Add New Object</h3>
              <button @click="cancelAdd" class="text-gray-400 hover:text-gray-200">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <!-- Mode Selector -->
            <div class="flex gap-2 mb-4">
              <button 
                @click="addMode = 'upload'"
                :class="[
                  'flex-1 px-3 py-2 text-xs font-semibold rounded transition-colors',
                  addMode === 'upload' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                ]"
              >
                📸 Upload Image
              </button>
              <button 
                @click="addMode = 'describe'"
                :class="[
                  'flex-1 px-3 py-2 text-xs font-semibold rounded transition-colors',
                  addMode === 'describe' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                ]"
              >
                ✍️ Describe
              </button>
              <button 
                @click="addMode = 'link'"
                :class="[
                  'flex-1 px-3 py-2 text-xs font-semibold rounded transition-colors',
                  addMode === 'link' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                ]"
              >
                🔗 From Link
              </button>
            </div>
        
            <!-- Upload Mode -->
            <div v-if="addMode === 'upload'">
              <div v-if="!addObjectImage" class="border-2 border-dashed border-gray-600 rounded p-6 text-center mb-3">
                <input type="file" @change="handleImageUpload" accept="image/*" class="hidden" ref="fileInput" />
                <button @click="$refs.fileInput.click()" class="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 rounded">
                  Upload Image
                </button>
              </div>

              <div v-else>
                <img :src="addObjectImage" class="w-32 h-32 object-cover rounded mx-auto mb-3" />
                
                <input 
                  v-model="addObjectName"
                  type="text"
                  placeholder="Object name (e.g., 'red chair')"
                  class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded mb-2"
                />

                <button 
                  @click="analyzeObject"
                  :disabled="!addObjectName.trim() || isAnalyzing"
                  class="w-full px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded mb-2 flex items-center justify-center gap-2"
                >
                  <div v-if="isAnalyzing" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  {{ isAnalyzing ? 'Analyzing...' : 'Analyze with Gemini' }}
                </button>

                <div v-if="addObjectDescription" class="p-3 bg-gray-700 rounded text-xs mb-3 max-h-32 overflow-y-auto">
                  {{ addObjectDescription }}
                </div>

                <div class="flex gap-2">
                  <button 
                    v-if="addObjectDescription"
                    @click="confirmAdd"
                    :disabled="isAdding"
                    class="flex-1 px-3 py-2 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
                  >
                    <div v-if="isAdding" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                    {{ isAdding ? 'Adding...' : 'Confirm' }}
                  </button>
                  <button 
                    @click="cancelAdd"
                    class="flex-1 px-3 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            <!-- Describe Mode -->
            <div v-else-if="addMode === 'describe'">
              <div class="mb-3">
                <label class="block text-xs font-semibold text-gray-300 mb-2">Describe the object you want to add:</label>
                <textarea 
                  v-model="addTextDescription"
                  placeholder="E.g., 'a modern black leather armchair with wooden legs' or 'a small round coffee table with a glass top'"
                  class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded resize-none"
                  rows="4"
                ></textarea>
              </div>

              <div class="flex gap-2">
                <button 
                  @click="confirmAddText"
                  :disabled="!addTextDescription.trim() || isAdding"
                  class="flex-1 px-3 py-2 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
                >
                  <div v-if="isAdding" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  {{ isAdding ? 'Add to Scene' : 'Add to Scene' }}
                </button>
                <button 
                  @click="cancelAdd"
                  class="flex-1 px-3 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>

            <!-- Link Mode -->
            <div v-else-if="addMode === 'link'">
              <div v-if="!linkMetadata" class="mb-3">
                <label class="block text-xs font-semibold text-gray-300 mb-2">Paste a product or furniture link:</label>
                <input 
                  v-model="addLinkUrl"
                  type="text"
                  placeholder="https://example.com/furniture-item"
                  class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded mb-2"
                  @keypress.enter="fetchLinkMetadata"
                />
                <button 
                  @click="fetchLinkMetadata"
                  :disabled="!addLinkUrl.trim() || isFetchingLink"
                  class="w-full px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
                >
                  <div v-if="isFetchingLink" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  {{ isFetchingLink ? 'Fetching...' : 'Fetch Link Data' }}
                </button>
              </div>

              <div v-else>
                <div class="mb-3 p-3 bg-gray-700 rounded">
                  <div v-if="addObjectImage" class="mb-2">
                    <img :src="addObjectImage" class="w-full h-32 object-cover rounded" />
                  </div>
                  <div class="text-sm font-semibold mb-1">{{ linkMetadata.title }}</div>
                  <div v-if="linkMetadata.description" class="text-xs text-gray-400 mb-2 line-clamp-3">{{ linkMetadata.description }}</div>
                  <div class="text-xs text-blue-400 truncate">{{ linkMetadata.normalizedUrl }}</div>
                </div>

                <input 
                  v-model="addObjectName"
                  type="text"
                  placeholder="Object name (edit if needed)"
                  class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded mb-2"
                />

                <button 
                  v-if="addObjectImage && !addObjectDescription"
                  @click="analyzeObject"
                  :disabled="!addObjectName.trim() || isAnalyzing"
                  class="w-full px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded mb-2 flex items-center justify-center gap-2"
                >
                  <div v-if="isAnalyzing" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  {{ isAnalyzing ? 'Analyzing...' : 'Analyze with Gemini' }}
                </button>

                <div v-if="addObjectDescription" class="p-3 bg-gray-700 rounded text-xs mb-3 max-h-32 overflow-y-auto">
                  {{ addObjectDescription }}
                </div>

                <div class="flex gap-2">
                  <button 
                    v-if="addObjectDescription"
                    @click="confirmAdd"
                    :disabled="isAdding"
                    class="flex-1 px-3 py-2 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
                  >
                    <div v-if="isAdding" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                    {{ isAdding ? 'Adding...' : 'Confirm' }}
                  </button>
                  <button 
                    @click="cancelAdd"
                    class="flex-1 px-3 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded"
                  >
                    {{ addObjectDescription ? 'Cancel' : 'Start Over' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Delete Confirmation -->
    <Transition name="fade">
      <div v-if="showDeleteConfirm" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]" @click.self="cancelDelete">
        <Transition name="scale">
          <div v-if="showDeleteConfirm" class="bg-gray-800 rounded-lg w-full max-w-sm mx-4 p-4">
            <h3 class="text-sm font-semibold mb-2">Confirm Deletion</h3>
            <p class="text-xs text-gray-400 mb-3">Remove {{ selectedObjects.length }} object(s)?</p>
            <div class="flex gap-2">
              <button 
                @click="confirmDelete"
                :disabled="isGenerating"
                class="flex-1 px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
              >
                <div v-if="isGenerating" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                {{ isGenerating ? 'Deleting...' : 'Delete' }}
              </button>
              <button 
                @click="cancelDelete"
                class="flex-1 px-3 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Edit Object Dialog -->
    <Transition name="fade">
      <div v-if="showEditDialog" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]" @click.self="cancelEdit">
        <Transition name="scale">
          <div v-if="showEditDialog" class="bg-gray-800 rounded-lg w-full max-w-2xl mx-4 p-4 max-h-[80vh] overflow-y-auto">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold">Edit Object {{ editObjectIndex + 1 }}</h3>
              <button @click="cancelEdit" class="text-gray-400 hover:text-gray-200">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            
            <div v-if="editObjectData" class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">Description</label>
                <textarea 
                  v-model="editObjectData.description"
                  class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded resize-none"
                  rows="3"
                ></textarea>
              </div>
              
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-gray-300 mb-1">Location</label>
                  <input 
                    v-model="editObjectData.location"
                    class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-300 mb-1">Relative Size</label>
                  <input 
                    v-model="editObjectData.relative_size"
                    class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded"
                  />
                </div>
              </div>
              
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">Shape and Color</label>
                <input 
                  v-model="editObjectData.shape_and_color"
                  class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded"
                />
              </div>
              
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">Texture</label>
                <input 
                  v-model="editObjectData.texture"
                  class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded"
                />
              </div>
              
              <div class="flex gap-2 pt-2">
                <button 
                  @click="applyEdit"
                  :disabled="isApplyingEdit"
                  class="flex-1 px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
                >
                  <div v-if="isApplyingEdit" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  {{ isApplyingEdit ? 'Applying...' : 'Apply Changes' }}
                </button>
                <button 
                  @click="cancelEdit"
                  class="flex-1 px-4 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Group Results Dialog -->
    <Transition name="fade">
      <div v-if="showGroupResults" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000] p-4" @click.self="closeGroupResults">
        <Transition name="scale">
          <div class="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div class="p-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold">Scene Segmentation Results</h3>
                <p class="text-xs text-gray-400 mt-1">These segmented renders will be intelligently converted to 3D. Objects are placed by AI based on the floor plan, and you can edit the 3D scene afterwards.</p>
              </div>
              <button 
                @click="closeGroupResults"
                class="text-gray-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  v-for="group in groupResults"
                  :key="group.id"
                  class="bg-gray-700 rounded-lg overflow-hidden h-48 flex shadow-sm"
                >
                  <!-- Image (left, square) -->
                  <div class="w-48 h-48 bg-gray-900 flex items-center justify-center">
                    <img 
                      :src="group.imageUrl"
                      :alt="group.name"
                      class="w-48 h-48 object-cover rounded-none"
                    />
                  </div>
                  <!-- Details (right) -->
                  <div class="flex-1 p-4 flex flex-col">
                    <div>
                      <h4 class="font-semibold text-sm">{{ group.name }}</h4>
                      <div class="mt-1 inline-flex items-center gap-2">
                        <span
                          :class="[
                            'px-2 py-0.5 text-xs rounded',
                            group.type === 'room' ? 'bg-blue-900 text-blue-200' : 'bg-purple-900 text-purple-200'
                          ]"
                        >
                          {{ group.type }}
                        </span>
                      </div>
                      <div class="text-[12px] text-gray-300 mt-2 leading-snug">{{ group.rationale }}</div>
                    </div>
                    <div class="mt-2 text-[11px] text-gray-300">Contains {{ group.objectIds.length }} object(s).</div>
                    <div class="mt-auto text-[11px] text-gray-100">Preview generated by Bria FIBO.</div>
                  </div>
                </div>
              </div>

              <div v-if="groupResults.length === 0" class="text-center py-12 text-gray-500">
                <div class="text-4xl mb-3">🔄</div>
                <p>Processing groups...</p>
              </div>
            </div>

            <div class="p-4 border-t border-gray-700">
              <div v-if="isGenerating3DAssets" class="text-xs text-gray-400 mb-2 flex items-center gap-2">
                <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                <span>{{ generating3DStatus || 'Working...' }}</span>
              </div>
              <button 
                @click="confirmConvertTo3DAndOpenStudio"
                :disabled="isGenerating3DAssets"
                class="w-full px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded mb-2"
              >
                {{ isGenerating3DAssets ? 'Generating 3D Assets...' : 'Generate 3D Assets & Open 3D Studio' }}
              </button>
              <button 
                @click="closeGroupResults"
                :disabled="isGenerating3DAssets"
                class="w-full px-4 py-2 text-sm font-semibold bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 rounded"
              >
                Close
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <BoundingBoxesDialog
      :show="showBoundingBoxes"
      :boxes="boundingBoxResults"
      :get-color-for-group="getColorForGroup"
      @close="closeBoundingBoxes"
    />
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.scale-enter-active, .scale-leave-active {
  transition: all 0.2s ease;
}
.scale-enter-from, .scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
/* additional debug styles are lightweight and reuse existing classes */
