<script setup>
import { ref, onMounted, nextTick, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  boxes: { type: Object, default: () => ({}) },
  getColorForGroup: { type: Function, required: true }
})
const emit = defineEmits(['close'])

const canvasRef = ref(null)
const CANVAS_SIZE = 1000

const draw = async () => {
  await nextTick()
  const canvasEl = canvasRef.value
  if (!canvasEl) return

  // Fixed 1000x1000 canvas
  canvasEl.width = CANVAS_SIZE
  canvasEl.height = CANVAS_SIZE

  const ctx = canvasEl.getContext('2d')
  
  // Clear and fill with white background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  if (!props.boxes) return

  const drawLabel = (ctx, x, y, text, color) => {
    ctx.fillStyle = color
    ctx.globalAlpha = 0.9
    const paddingX = 4
    const paddingY = 2
    ctx.font = '14px sans-serif'
    const metrics = ctx.measureText(text)
    const bgWidth = metrics.width + paddingX * 2
    const bgHeight = 18
    ctx.fillRect(x, y - bgHeight, bgWidth, bgHeight)
    ctx.globalAlpha = 1.0
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, x + paddingX, y - bgHeight + 14)
  }

  for (const groupName in props.boxes) {
    const group = props.boxes[groupName]
    const color = props.getColorForGroup(groupName)
    if (!group || !Array.isArray(group.bounding_boxes)) continue

    for (const bbox of group.bounding_boxes) {
      // bbox format: [ymin, xmin, ymax, xmax], scale [0,1000]
      // Directly use values as canvas is 1000x1000
      const ymin = bbox[0]
      const xmin = bbox[1]
      const ymax = bbox[2]
      const xmax = bbox[3]

      const x = Math.round(xmin)
      const y = Math.round(ymin)
      const w = Math.round(xmax - xmin)
      const h = Math.round(ymax - ymin)

      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.strokeRect(x, y, w, h)

      drawLabel(ctx, x + 4, y + 22, groupName, color)
    }
  }
}

watch(() => props.boxes, async () => { await draw() })
watch(() => props.show, async (newVal) => { if (newVal) await draw() })

</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000] p-4">
      <Transition name="scale">
        <div class="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
          <div class="p-4 border-b border-gray-700 flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold">Furniture Detection Results</h3>
              <p class="text-xs text-gray-400 mt-1">Bounding boxes detected on floor plan</p>
            </div>
            <button @click="$emit('close')" class="text-gray-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <div class="flex-1 overflow-y-auto p-4 flex justify-center items-start">
            <div class="bg-gray-900 rounded-lg p-4">
              <canvas ref="canvasRef" class="border border-gray-700" style="max-width: 100%; height: auto;"></canvas>
            </div>

            <div class="mt-4 p-4 bg-gray-700 rounded-lg" v-if="boxes">
              <h4 class="text-sm font-semibold mb-3">Detected Groups</h4>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div v-for="(group, groupName) in boxes" :key="groupName" class="flex items-center gap-2">
                  <div class="w-4 h-4 rounded" :style="{ backgroundColor: getColorForGroup(groupName) }"></div>
                  <div class="text-xs">
                    <div class="font-semibold">{{ groupName }}</div>
                    <div class="text-gray-400">{{ group.bounding_boxes.length }} box(es)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="p-4 border-t border-gray-700">
            <button @click="$emit('close')" class="w-full px-4 py-2 text-sm font-semibold bg-gray-600 hover:bg-gray-500 rounded">Close</button>
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
