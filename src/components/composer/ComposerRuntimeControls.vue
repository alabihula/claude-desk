<script setup>
import { computed, ref, watch } from 'vue'
import { BrainCircuit, ChevronDown, Cpu } from 'lucide-vue-next'
import { useI18n } from '../../services/i18n'
import { useCloseOnOutsidePointerDown } from '../../services/clickOutside'

const props = defineProps({
  model: { type: String, default: '' },
  effort: { type: String, default: '' },
  defaultModel: { type: String, default: '' },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['change'])
const { t } = useI18n()
const controls = ref(null)
const modelMenu = ref(null)
const effortMenu = ref(null)
const customModel = ref(props.model || '')

const modelOptions = computed(() => [...new Set([
  props.defaultModel,
  'best',
  'fable',
  'sonnet',
  'opus',
  'haiku',
  'opusplan',
  'sonnet[1m]',
  'opus[1m]',
  'opusplan[1m]',
].filter(Boolean))])
const modelSummary = computed(() => props.model || props.defaultModel || t('composer.defaultModel'))
const effortSummary = computed(() => t(`composer.effort.${props.effort || 'auto'}`))

watch(() => props.model, (value) => { customModel.value = value || '' })

function closeMenus(except) {
  if (except !== modelMenu.value && modelMenu.value) modelMenu.value.open = false
  if (except !== effortMenu.value && effortMenu.value) effortMenu.value.open = false
}

useCloseOnOutsidePointerDown(controls, () => closeMenus())

function toggled(event) {
  if (props.saving) {
    event.currentTarget.open = false
    return
  }
  if (event.currentTarget.open) closeMenus(event.currentTarget)
}

function selectModel(model) {
  emit('change', { model: model || null })
  modelMenu.value.open = false
}

function applyCustomModel() {
  const model = customModel.value.trim()
  if (model) selectModel(model)
}

function selectEffort(effort) {
  emit('change', { effort: effort === 'auto' ? null : effort })
  effortMenu.value.open = false
}
</script>

<template>
  <div ref="controls" class="runtime-controls">
    <details ref="modelMenu" class="runtime-control" @toggle="toggled">
      <summary :title="t('composer.modelCurrent', { model: modelSummary })">
        <Cpu :size="14" /><span>{{ modelSummary }}</span><ChevronDown :size="12" />
      </summary>
      <div class="runtime-popover model-popover">
        <strong>{{ t('composer.model') }}</strong>
        <button :disabled="saving" :class="{ active: !model }" @click="selectModel(null)">
          <span>{{ t('composer.defaultModel') }}</span><small>{{ defaultModel || t('composer.followSettings') }}</small>
        </button>
        <button v-for="option in modelOptions" :key="option" :disabled="saving" :class="{ active: model === option }" @click="selectModel(option)">
          <span>{{ option }}</span>
        </button>
        <form class="runtime-custom-model" @submit.prevent="applyCustomModel">
          <input v-model="customModel" :disabled="saving" :placeholder="t('composer.customModel')" spellcheck="false" />
          <button type="submit" :disabled="saving || !customModel.trim()">{{ t('common.apply') }}</button>
        </form>
        <p>{{ t('composer.oneMillionHelp') }}</p>
      </div>
    </details>

    <details ref="effortMenu" class="runtime-control" @toggle="toggled">
      <summary :title="t('composer.effortCurrent', { effort: effortSummary })">
        <BrainCircuit :size="14" /><span>{{ effortSummary }}</span><ChevronDown :size="12" />
      </summary>
      <div class="runtime-popover effort-popover">
        <strong>{{ t('composer.effort') }}</strong>
        <button
          v-for="level in ['auto', 'low', 'medium', 'high', 'xhigh', 'max']"
          :key="level"
          :disabled="saving"
          :class="{ active: (effort || 'auto') === level }"
          @click="selectEffort(level)"
        >
          <span>{{ t(`composer.effort.${level}`) }}</span>
          <small>{{ t(`composer.effortHelp.${level}`) }}</small>
        </button>
      </div>
    </details>
  </div>
</template>
