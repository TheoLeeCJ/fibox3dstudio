<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['continue-anonymous', 'sign-in-google'])

const isLoading = ref(false)
const loadingAction = ref(null)

const handleContinueAnonymous = async () => {
  isLoading.value = true
  loadingAction.value = 'anonymous'
  try {
    emit('continue-anonymous')
  } finally {
    isLoading.value = false
    loadingAction.value = null
  }
}

const handleSignInGoogle = async () => {
  isLoading.value = true
  loadingAction.value = 'google'
  try {
    emit('sign-in-google')
  } finally {
    isLoading.value = false
    loadingAction.value = null
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4">
      <div class="bg-gray-800 rounded-xl w-full max-w-md p-8 shadow-2xl border border-gray-700">
        <!-- Logo / Title -->
        <div class="text-center mb-8">
          <div class="text-4xl mb-3">🎨</div>
          <h1 class="text-2xl font-bold text-white mb-2">Welcome to 3D Studio</h1>
          <p class="text-gray-400 text-sm">Create stunning 3D interior designs with AI</p>
        </div>

        <!-- Auth Options -->
        <div class="space-y-4">
          <!-- Sign in with Google -->
          <button
            @click="handleSignInGoogle"
            :disabled="isLoading"
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors"
          >
            <svg v-if="loadingAction !== 'google'" class="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <div v-else class="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-800"></div>
            <span>Sign in with Google</span>
          </button>

          <!-- Benefits for Google sign-in -->
          <div class="flex items-start gap-2 px-2 text-xs text-gray-400">
            <span class="text-green-400">✓</span>
            <span>Sync projects across devices • Store in the cloud</span>
          </div>

          <!-- Divider -->
          <div class="flex items-center gap-4 py-2">
            <div class="flex-1 h-px bg-gray-700"></div>
            <span class="text-gray-500 text-sm">or</span>
            <div class="flex-1 h-px bg-gray-700"></div>
          </div>

          <!-- Continue without account -->
          <button
            @click="handleContinueAnonymous"
            :disabled="isLoading"
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-200 font-semibold rounded-lg transition-colors"
          >
            <span v-if="loadingAction !== 'anonymous'" class="text-xl">👤</span>
            <div v-else class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            <span>Continue without account</span>
          </button>

          <!-- Info for anonymous -->
          <div class="flex items-start gap-2 px-2 text-xs text-gray-400">
            <span class="text-yellow-400">⚡</span>
            <span>Limited quota • Upgrade to full account anytime</span>
          </div>
        </div>

        <!-- Quota Info -->
        <div class="mt-8 p-4 bg-gray-900 rounded-lg border border-gray-700">
          <div class="text-sm font-semibold text-gray-300 mb-2">Free tier includes:</div>
          <div class="flex justify-between text-sm text-gray-400">
            <span>🖼️ 200 image generations</span>
            <span>🧊 100 3D models</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="mt-6 text-center text-xs text-gray-500">
          By continuing, you agree to our Terms of Service
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
