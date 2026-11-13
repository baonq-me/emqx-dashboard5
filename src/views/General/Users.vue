<template>
  <div class="users app-wrapper">
    <el-card v-if="ssoStatus && ssoStatus.enable" class="sso-login-methods" shadow="never" data-test="login-methods">
      <div class="sso-card-hd">{{ tl('loginMethods') }}</div>
      <div class="sso-row">
        <el-switch
          :model-value="ssoStatus.password_login"
          :loading="ssoSaving"
          data-test="password-login-switch"
          @change="togglePasswordLogin"
        />
        <span class="sso-label">{{ tl('allowPasswordLogin') }}</span>
      </div>
      <p class="sso-tip">{{ tl('allowPasswordLoginTip') }}</p>
    </el-card>
    <div class="section-header">
      <div></div>
      <CreateButton @click="showDialog()" />
    </div>

    <el-table :data="tableData" v-loading.lock="lockTable">
      <el-table-column prop="username" :label="tl('username')">
        <template #default="{ row }">
          {{ row.username }}
          <el-tag v-if="isSsoProxyUser(row.username, ssoStatus)" size="small" class="sso-tag">
            Keycloak
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" :label="t('Base.note')" />
      <el-table-column :label="$t('Base.operation')">
        <template #default="{ row }">
          <TableButton @click="showDialog('edit', row)">
            {{ $t('Base.edit') }}
          </TableButton>
          <TableButton
            v-if="!isSsoProxyUser(row.username, ssoStatus)"
            @click="showDialog('chPass', row)"
          >
            {{ tl('changePassword') }}
          </TableButton>

          <TableButton
            @click="deleteConfirm(row)"
            v-if="currentUser.username !== row.username && row.username !== 'admin'"
          >
            {{ $t('Base.delete') }}
          </TableButton>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      :title="
        accessType === 'edit'
          ? tl('editorUser')
          : accessType === 'chPass'
          ? tl('changePassword')
          : tl('creatingUser')
      "
      v-model="dialogVisible"
      destroy-on-close
      width="650px"
    >
      <el-form
        ref="formCom"
        :model="record"
        :rules="rules"
        label-position="top"
        require-asterisk-position="right"
        @keyup.enter="save()"
      >
        <el-form-item v-if="accessType !== 'chPass'" prop="username" :label="tl('username')">
          <el-input
            v-model="record.username"
            :disabled="accessType === 'edit'"
            @change="trimUserName"
          />
        </el-form-item>
        <el-form-item v-if="accessType !== 'chPass'" :label="t('Base.note')">
          <el-input v-model="record.description" />
        </el-form-item>
        <el-form-item v-if="accessType !== 'edit'" prop="password" :label="tl('password')">
          <el-input
            v-model="record.password"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
        <div v-if="accessType === 'chPass'">
          <el-form-item prop="newPassword" :label="tl('newPassword')">
            <el-input
              v-model="record.newPassword"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item prop="repeatPassword" :label="tl('confirmPassword')">
            <el-input
              v-model="record.repeatPassword"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <div class="dialog-align-footer">
          <el-button @click="closeDialog">
            {{ $t('Base.cancel') }}
          </el-button>

          <el-button type="primary" @click="save" :loading="submitLoading">
            {{ accessType == 'create' ? $t('Base.create') : $t('Base.confirm') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { loadUser, createUser, updateUser, destroyUser, changePassword } from '@/api/function.ts'
import { getSsoProxyStatus, isSsoProxyUser, setPasswordLogin } from '@/api/ssoProxy'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useStore } from 'vuex'
import { computed, ref, onBeforeMount } from 'vue'
import useI18nTl from '@/hooks/useI18nTl.ts'
import { PASSWORD_REG } from '@/common/constants'
import useFormRules from '@/hooks/useFormRules'

const store = useStore()
const { tl, t } = useI18nTl('General')

const dialogVisible = ref(false)
const tableData = ref([])
const lockTable = ref(false)
const accessType = ref('')
const record = ref({})
const submitLoading = ref(false)
const formCom = ref()

const validatePass = (rule, value, callback) => {
  if (value !== record.value.newPassword) {
    callback(new Error(tl('confirmNotMatch')))
  } else {
    callback()
  }
}

/**
 * is the new password same as the old password?
 */
const newPwdSameConfirm = (rule, value, callback) => {
  if (value === record.value.password) {
    callback(new Error(tl('noSameNewPwd')))
  } else {
    callback()
  }
}

const { createNoChineseRule } = useFormRules()
const pwdMismatchMsg =
  tl('passwordRequirement1') + tl('semicolon') + tl('passwordRequirement2').toLowerCase()
const rules = computed(() => {
  const ret = {
    username: [{ required: true, message: tl('enterOneUserName') }, ...createNoChineseRule()],
    password: [
      {
        required: true,
        message: tl('pleaseEnterPassword'),
        trigger: ['blur', 'change'],
      },
    ],
    newPassword: [
      {
        required: true,
        message: tl('pleaseEnterNewPassword'),
        trigger: ['blur', 'change'],
      },
      {
        pattern: PASSWORD_REG,
        message: pwdMismatchMsg,
        trigger: ['blur'],
      },
      {
        validator: newPwdSameConfirm,
        trigger: ['blur'],
      },
    ],
    repeatPassword: [
      {
        required: true,
        message: tl('pleaseEnterAConfirmationPassword'),
      },
      { validator: validatePass, trigger: ['blur', 'change'] },
    ],
  }
  if (accessType.value !== 'chPass') {
    ret.password.push({
      pattern: PASSWORD_REG,
      message: pwdMismatchMsg,
      trigger: ['blur'],
    })
  }
  return ret
})
const currentUser = computed(() => {
  return store.state.user
})

const loadData = async () => {
  lockTable.value = true
  try {
    tableData.value = await loadUser()
  } catch (error) {
    //
  } finally {
    lockTable.value = false
  }
}

const showDialog = (type = 'create', item = {}) => {
  dialogVisible.value = true
  formCom.value?.resetFields()

  if (type === 'edit') {
    record.value = Object.assign({}, item)
  } else if (type === 'chPass') {
    record.value = {
      username: item.username,
      password: '',
      newPassword: '',
      repeatPassword: '',
    }
  } else {
    record.value = {
      username: '',
      description: '',
      password: '',
    }
  }
  accessType.value = type
}

const closeDialog = () => {
  dialogVisible.value = false
}

const trimUserName = () => {
  record.value.username = record.value.username.trim()
}

const save = async () => {
  try {
    await formCom.value.validate()
    submitLoading.value = true
    const { username } = record.value
    if (accessType.value === 'edit') {
      await updateUser(username, record.value)
      ElMessage.success(t('Base.updateSuccess'))
    } else if (accessType.value === 'chPass') {
      let pass = {
        new_pwd: record.value.newPassword,
        old_pwd: record.value.password,
      }
      await changePassword(username, pass)
      ElMessage.success(tl('changePassSuccess'))
      if (username === currentUser.value.username) {
        store.commit('SET_AFTER_CURRENT_USER_PWD_CHANGED', true)
      }
    } else {
      await createUser(record.value)
      ElMessage.success(tl('createUserSuccess'))
    }
    loadData()
    dialogVisible.value = false
  } catch (error) {
    //
  } finally {
    submitLoading.value = false
  }
}

const deleteConfirm = async (item) => {
  if (item.username === currentUser.value.username) {
    return
  }
  try {
    await ElMessageBox.confirm(tl('confirmDeleteUser'), {
      confirmButtonText: t('Base.confirm'),
      cancelButtonText: t('Base.cancel'),
      confirmButtonClass: 'confirm-danger',
      type: 'warning',
    })
    await destroyUser(item.username)
    ElMessage.success(t('Base.deleteSuccess'))
    loadData()
  } catch (error) {
    //
  }
}

const ssoStatus = ref(null)
const ssoSaving = ref(false)
const togglePasswordLogin = async (value) => {
  if (!value) {
    try {
      await ElMessageBox.confirm(tl('disablePasswordLoginConfirm'), {
        confirmButtonText: t('Base.confirm'),
        cancelButtonText: t('Base.cancel'),
        type: 'warning',
      })
    } catch (e) {
      return
    }
  }
  ssoSaving.value = true
  try {
    const res = await setPasswordLogin(value)
    ssoStatus.value = { ...ssoStatus.value, password_login: res.password_login }
    ElMessage.success(t('Base.updateSuccess'))
  } catch (error) {
    if (error?.response?.status === 409) {
      ElMessage.error(tl('disablePasswordLoginNotAllowed'))
    }
  } finally {
    ssoSaving.value = false
  }
}
onBeforeMount(async () => {
  ssoStatus.value = await getSsoProxyStatus(true)
  await loadData()
})
</script>

<style lang="scss">
.sso-login-methods {
  margin-bottom: 16px;
  .sso-card-hd {
    font-weight: 600;
    margin-bottom: 12px;
  }
  .sso-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .sso-tip {
    margin: 8px 0 0;
    color: var(--color-text-secondary);
    font-size: 13px;
  }
}
.sso-tag {
  margin-left: 6px;
}
</style>
