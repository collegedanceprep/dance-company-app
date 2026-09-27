import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native"

type Props = {
  visible: boolean
  appStoreUrl: string
}

export function ForceUpdateModal({ visible, appStoreUrl }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Update required</Text>
          <Text style={styles.body}>
            A new version of College Dance Prep is available. Please update to continue using the app.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(appStoreUrl)}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Update now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Sora_600SemiBold",
    color: "#111827",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    fontFamily: "Geist_400Regular",
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: "100%",
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Sora_600SemiBold",
  },
})
