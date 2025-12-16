<script setup>
import { ref, nextTick } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  getColorForGroup: { type: Function, required: true }
})
const emit = defineEmits(['close', 'apply'])

const debugImageUrl = ref('')
const debugJsonText = ref('')
const canvasRef = ref(null)
const imgRef = ref(null)
const boxes = ref({})

const draw = async () => {
  await nextTick()
  const imgEl = imgRef.value
  const canvasEl = canvasRef.value
  if (!imgEl || !canvasEl) return

  const rect = imgEl.getBoundingClientRect()
  canvasEl.width = Math.round(rect.width)
  canvasEl.height = Math.round(rect.height)
  canvasEl.style.width = rect.width + 'px'
  canvasEl.style.height = rect.height + 'px'

  const ctx = canvasEl.getContext('2d')
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
  if (!boxes.value) return

  const drawLabel = (ctx, x, y, text, color) => {
    ctx.fillStyle = color
    ctx.globalAlpha = 0.9
    const paddingX = 4
    const paddingY = 2
    ctx.font = '12px sans-serif'
    const metrics = ctx.measureText(text)
    const bgWidth = metrics.width + paddingX * 2
    const bgHeight = 16
    ctx.fillRect(x, y - bgHeight, bgWidth, bgHeight)
    ctx.globalAlpha = 1.0
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, x + paddingX, y - bgHeight + 12)
  }

  for (const groupName in boxes.value) {
    const group = boxes.value[groupName]
    const color = props.getColorForGroup(groupName)
    if (!group || !Array.isArray(group.bounding_boxes)) continue

    for (const bbox of group.bounding_boxes) {
      const ymin = bbox[0] / 1000
      const xmin = bbox[1] / 1000
      const ymax = bbox[2] / 1000
      const xmax = bbox[3] / 1000

      const x = Math.round(xmin * canvasEl.width)
      const y = Math.round(ymin * canvasEl.height)
      const w = Math.round((xmax - xmin) * canvasEl.width)
      const h = Math.round((ymax - ymin) * canvasEl.height)

      const colorStroke = color
      const ctx = canvasEl.getContext('2d')
      ctx.strokeStyle = colorStroke
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)

      drawLabel(ctx, x + 2, y + 18, groupName, colorStroke)
    }
  }
}

const handleImageUpload = (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => { debugImageUrl.value = String(e.target?.result || '') }
  reader.readAsDataURL(file)
}

const applyDebugJson = () => {
  if (!debugJsonText.value) return
  try {
    const parsed = JSON.parse(debugJsonText.value)
    if (Array.isArray(parsed)) {
      boxes.value = { 'Debug Group': { bounding_boxes: parsed } }
    } else if (parsed.groups) {
      const out = {}
      parsed.groups.forEach((g) => {
        const b = g.bounding_boxes || g.boxes || []
        out[g.name || g.id || 'Group'] = { bounding_boxes: b }
      })
      boxes.value = out
    } else {
      boxes.value = parsed
    }
    draw()
    emit('apply', boxes.value)
  } catch (e) {
    alert('Invalid JSON. Please check the format.')
  }
}

const clearDebug = () => {
  debugImageUrl.value = ''
  debugJsonText.value = ''
  boxes.value = {}
  const canvasEl = canvasRef.value
  if (canvasEl) {
    const ctx = canvasEl.getContext('2d')
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="props.show" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000] p-4" @click.self="emit('close')">
      <Transition name="scale">
        <div class="bg-gray-800 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <div class="p-4 border-b border-gray-700 flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold">Debug Bounding Boxes</h3>
              <p class="text-xs text-gray-400 mt-1">Upload image and paste JSON to test overlay</p>
            </div>
            <button @click="emit('close')" class="text-gray-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">Upload Test Image</label>
                <input type="file" accept="image/*" @change="handleImageUpload" class="text-xs" />
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">Paste Gemini JSON</label>
                <textarea v-model="debugJsonText" rows="10" class="w-full px-3 py-2 text-xs bg-gray-700 border border-gray-600 rounded resize-none" placeholder='{"Group": {"bounding_boxes": [[100,200,300,400]]}}'></textarea>
              </div>
              <div class="flex gap-2">
                <button @click="applyDebugJson" class="flex-1 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 rounded">Apply JSON</button>
                <button @click="clearDebug" class="flex-1 px-3 py-2 text-xs font-semibold bg-gray-600 hover:bg-gray-500 rounded">Clear</button>
              </div>
            </div>

            <div class="bg-gray-900 rounded-lg p-4 inline-block relative" v-if="debugImageUrl">
              <div class="relative inline-block">
                <img :src="debugImageUrl" alt="Debug Image" class="max-w-full" ref="imgRef" @load="draw" />
                <canvas ref="canvasRef" class="absolute top-0 left-0 pointer-events-none" style="z-index: 10;"></canvas>
              </div>
            </div>
          </div>

          <div class="p-4 border-t border-gray-700">
            <button @click="emit('close')" class="w-full px-4 py-2 text-sm font-semibold bg-gray-600 hover:bg-gray-500 rounded">Close</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.scale-enter-active, .scale-leave-active { transition: all 0.2s ease; }
.scale-enter-from, .scale-leave-to { opacity: 0; transform: scale(0.95); }
</style>
