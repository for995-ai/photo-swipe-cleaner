/**
 * 用純 View 疊出來的圖示，避免引入任何第三方 UI／圖示套件。
 * 尺寸全部依 size 等比推算，在不同 iPhone 上都不會走鐘。
 */
import { StyleSheet, Text, View } from 'react-native';

export function TrashIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.1,
          backgroundColor: color,
          borderTopLeftRadius: size * 0.05,
          borderTopRightRadius: size * 0.05,
        }}
      />
      <View
        style={{
          width: size,
          height: size * 0.12,
          marginTop: size * 0.04,
          backgroundColor: color,
          borderRadius: size * 0.06,
        }}
      />
      <View
        style={{
          width: size * 0.74,
          flex: 1,
          marginTop: size * 0.07,
          borderColor: color,
          borderLeftWidth: size * 0.1,
          borderRightWidth: size * 0.1,
          borderBottomWidth: size * 0.1,
          borderBottomLeftRadius: size * 0.18,
          borderBottomRightRadius: size * 0.18,
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          paddingVertical: size * 0.08,
        }}>
        <View style={{ width: size * 0.07, backgroundColor: color, borderRadius: size * 0.04 }} />
        <View style={{ width: size * 0.07, backgroundColor: color, borderRadius: size * 0.04 }} />
      </View>
    </View>
  );
}

export function CheckIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <View style={[styles.box, styles.centered, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.42,
          height: size * 0.76,
          marginTop: -size * 0.14,
          borderColor: color,
          borderRightWidth: size * 0.13,
          borderBottomWidth: size * 0.13,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function UndoIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <View style={[styles.box, styles.centered, { width: size, height: size }]}>
      <Text style={{ color, fontSize: size, lineHeight: size * 1.15 }}>↺</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
  },
  centered: {
    justifyContent: 'center',
  },
});
