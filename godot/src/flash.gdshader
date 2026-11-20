shader_type canvas_item;
// 受击白闪：把图层里的贴图整体染白（保留透明度）
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	COLOR = vec4(1.0, 1.0, 1.0, c.a * COLOR.a);
}
