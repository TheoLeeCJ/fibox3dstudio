// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js'
import { 
  getAuth, 
  signInAnonymously, 
  signInWithPopup, 
  GoogleAuthProvider,
  onAuthStateChanged,
  linkWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js'
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js'
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
  list
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js'

// Firebase configuration
const firebaseConfig = {
//...
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)

// Google Auth Provider
const googleProvider = new GoogleAuthProvider()

// Initial quotas for new users
const INITIAL_IMAGE_QUOTA = 200
const INITIAL_MODEL_QUOTA = 100

/**
 * Sign in anonymously
 */
export async function signInAnonymousUser() {
  try {
    const result = await signInAnonymously(auth)
    await ensureUserDocument(result.user, 'anonymous')
    return result.user
  } catch (error) {
    console.error('Anonymous sign-in error:', error)
    throw error
  }
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider)
    await ensureUserDocument(result.user, 'google')
    return result.user
  } catch (error) {
    console.error('Google sign-in error:', error)
    throw error
  }
}

/**
 * Link anonymous account to Google (upgrade)
 */
export async function linkAnonymousToGoogle() {
  try {
    if (!auth.currentUser) throw new Error('No user signed in')
    if (!auth.currentUser.isAnonymous) throw new Error('User is not anonymous')
    
    const result = await linkWithPopup(auth.currentUser, googleProvider)
    
    // Update user document to reflect google auth
    const userRef = doc(db, 'users', result.user.uid)
    await updateDoc(userRef, {
      authType: 'google',
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL
    })
    
    return result.user
  } catch (error) {
    console.error('Link to Google error:', error)
    throw error
  }
}

/**
 * Sign out
 */
export async function signOutUser() {
  try {
    await signOut(auth)
  } catch (error) {
    console.error('Sign out error:', error)
    throw error
  }
}

/**
 * Ensure user document exists with initial quotas
 */
async function ensureUserDocument(user, authType) {
  const userRef = doc(db, 'users', user.uid)
  const userSnap = await getDoc(userRef)
  
  if (!userSnap.exists()) {
    // Create new user document with initial quotas
    await setDoc(userRef, {
      authType,
      imagesQuota: INITIAL_IMAGE_QUOTA,
      modelsQuota: INITIAL_MODEL_QUOTA,
      imagesUsed: 0,
      modelsUsed: 0,
      createdAt: serverTimestamp(),
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null
    })
  }
}

/**
 * Get user quota info
 */
export async function getUserQuota() {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const userRef = doc(db, 'users', auth.currentUser.uid)
  const userSnap = await getDoc(userRef)
  
  if (!userSnap.exists()) throw new Error('User document not found')
  
  const data = userSnap.data()
  return {
    imagesQuota: data.imagesQuota,
    modelsQuota: data.modelsQuota,
    imagesUsed: data.imagesUsed,
    modelsUsed: data.modelsUsed,
    imagesRemaining: data.imagesQuota - data.imagesUsed,
    modelsRemaining: data.modelsQuota - data.modelsUsed
  }
}

/**
 * Get ID token for backend API calls
 */
export async function getIdToken() {
  if (!auth.currentUser) throw new Error('No user signed in')
  return auth.currentUser.getIdToken()
}

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return auth.currentUser
}

// ========== Project Management ==========

/**
 * Create a new project
 */
export async function createProject(name) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const projectsRef = collection(db, 'users', auth.currentUser.uid, 'projects')
  const projectId = `project_${Date.now()}`
  const projectRef = doc(projectsRef, projectId)
  
  await setDoc(projectRef, {
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  
  return projectId
}

/**
 * Get all projects for current user
 */
export async function getProjects() {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const projectsRef = collection(db, 'users', auth.currentUser.uid, 'projects')
  const q = query(projectsRef, orderBy('updatedAt', 'desc'))
  const snapshot = await getDocs(q)
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
}

/**
 * Save project state to Storage
 */
export async function saveProject(projectId, projectState) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const userId = auth.currentUser.uid
  const storageRef = ref(storage, `users/${userId}/projects/${projectId}/project.json`)
  
  // Upload project state as JSON
  const jsonString = JSON.stringify(projectState)
  await uploadString(storageRef, jsonString, 'raw', {
    contentType: 'application/json'
  })
  
  // Update project metadata
  const projectRef = doc(db, 'users', userId, 'projects', projectId)
  await updateDoc(projectRef, {
    updatedAt: serverTimestamp()
  })
  
  return true
}

/**
 * Load project state from Storage
 */
export async function loadProject(projectId) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const userId = auth.currentUser.uid
  const storageRef = ref(storage, `users/${userId}/projects/${projectId}/project.json`)
  
  try {
    const url = await getDownloadURL(storageRef)
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to fetch project')
    return await response.json()
  } catch (error) {
    if (error.code === 'storage/object-not-found') {
      return null // Project file doesn't exist yet
    }
    throw error
  }
}

/**
 * Delete a project
 */
export async function deleteProject(projectId) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const userId = auth.currentUser.uid
  
  // Delete from Firestore
  const projectRef = doc(db, 'users', userId, 'projects', projectId)
  await deleteDoc(projectRef)
  
  // Try to delete from Storage (may not exist)
  try {
    const storageRef = ref(storage, `users/${userId}/projects/${projectId}/project.json`)
    await deleteObject(storageRef)
  } catch (error) {
    // Ignore if file doesn't exist
    if (error.code !== 'storage/object-not-found') {
      console.warn('Failed to delete project file:', error)
    }
  }
  
  return true
}

/**
 * Rename a project
 */
export async function renameProject(projectId, newName) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const projectRef = doc(db, 'users', auth.currentUser.uid, 'projects', projectId)
  await updateDoc(projectRef, {
    name: newName,
    updatedAt: serverTimestamp()
  })
  
  return true
}

/**
 * Get renders for current user with pagination
 * @param {string|null} pageToken - Token for next page, null for first page
 * @param {number} pageSize - Number of items per page (default 8)
 */
export async function getRenders(pageToken = null, pageSize = 8) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  const userId = auth.currentUser.uid
  const rendersRef = ref(storage, `users/${userId}/renders`)
  
  try {
    const listOptions = { maxResults: pageSize }
    if (pageToken) {
      listOptions.pageToken = pageToken
    }
    
    const result = await list(rendersRef, listOptions)
    
    // Get download URLs for all items
    const renders = await Promise.all(
      result.items.map(async (item) => {
        const url = await getDownloadURL(item)
        return {
          name: item.name,
          url,
          fullPath: item.fullPath
        }
      })
    )
    
    // Sort by name (which includes timestamp) descending
    const sortedRenders = renders.sort((a, b) => b.name.localeCompare(a.name))
    
    return {
      renders: sortedRenders,
      nextPageToken: result.nextPageToken || null,
      hasMore: !!result.nextPageToken
    }
  } catch (error) {
    if (error.code === 'storage/object-not-found') {
      return { renders: [], nextPageToken: null, hasMore: false }
    }
    throw error
  }
}

/**
 * Create a project variation from a specific activity state
 */
export async function createProjectVariation(baseName, activityState) {
  if (!auth.currentUser) throw new Error('No user signed in')
  
  // Generate variation name
  const variationName = `${baseName}_variation`
  
  // Create the project
  const projectId = await createProject(variationName)
  
  // Build project state from activity
  const projectState = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    structuredPrompt: activityState.structuredPrompt,
    seed: activityState.seed,
    imageUrl: activityState.imageUrl,
    furnitureList: activityState.furnitureList || null,
    glbList: activityState.glbList || [],
    studioBoundingBoxes: activityState.studioBoundingBoxes || null,
    studioGlbAssignments: activityState.studioGlbAssignments || {},
    ideationBoundingBoxes: activityState.ideationBoundingBoxes || null,
    activityHistory: activityState.activityHistory || [],
    currentHistoryIndex: activityState.currentHistoryIndex ?? -1
  }
  
  // Save the state
  await saveProject(projectId, projectState)
  
  return {
    projectId,
    projectName: variationName,
    projectState
  }
}

export { auth, db, storage }
