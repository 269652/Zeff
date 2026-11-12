/**
 * What every Rust cell starts with (std only): `input("Name")` reads what the cell takes in as a small JSON value (a table of Zeff is
 * {cols, rows}), and the cell's last expression — or `zeff_return!(value)` — is handed on as its output, as JSON (numbers, text,
 * bool, Vec, Option, tuples, maps; anything else as its Debug text). `shared_get(key)` / `shared_set(key, value)` / `shared_remove(key)` /
 * `shared_keys()` are the shared storage of the page (strings, like in the other languages). Written once per program, before the items of the cells before it.
 */
export const RUST_PRELUDE = String.raw`
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum Json { Null, Bool(bool), Num(f64), Str(String), Arr(Vec<Json>), Obj(Vec<(String, Json)>) }
#[allow(dead_code)]
impl Json {
    pub fn get(&self, key: &str) -> &Json { if let Json::Obj(o) = self { for (k, v) in o { if k == key { return v; } } } &Json::Null }
    pub fn at(&self, i: usize) -> &Json { if let Json::Arr(a) = self { if let Some(v) = a.get(i) { return v; } } &Json::Null }
    pub fn len(&self) -> usize { match self { Json::Arr(a) => a.len(), Json::Obj(o) => o.len(), Json::Str(s) => s.len(), _ => 0 } }
    pub fn items(&self) -> Vec<&Json> { match self { Json::Arr(a) => a.iter().collect(), _ => vec![] } }
    pub fn as_f64(&self) -> f64 { match self { Json::Num(n) => *n, Json::Str(s) => s.trim().parse().unwrap_or(f64::NAN), Json::Bool(b) => if *b { 1.0 } else { 0.0 }, _ => f64::NAN } }
    pub fn as_str(&self) -> &str { match self { Json::Str(s) => s.as_str(), _ => "" } }
    pub fn cols(&self) -> Vec<String> { self.get("cols").items().iter().map(|c| c.as_str().to_string()).collect() }
    pub fn rows(&self) -> Vec<&Json> { self.get("rows").items() }
}
struct ZeffP<'a> { s: &'a [u8], i: usize }
#[allow(dead_code)]
impl<'a> ZeffP<'a> {
    fn ws(&mut self) { while self.i < self.s.len() && (self.s[self.i] as char).is_whitespace() { self.i += 1; } }
    fn val(&mut self) -> Json {
        self.ws();
        if self.i >= self.s.len() { return Json::Null; }
        match self.s[self.i] {
            b'{' => { self.i += 1; let mut o = vec![]; loop { self.ws(); if self.i >= self.s.len() { break; } if self.s[self.i] == b'}' { self.i += 1; break; } if self.s[self.i] == b',' { self.i += 1; continue; } let k = if let Json::Str(k) = self.val() { k } else { String::new() }; self.ws(); if self.i < self.s.len() && self.s[self.i] == b':' { self.i += 1; } let v = self.val(); o.push((k, v)); } Json::Obj(o) }
            b'[' => { self.i += 1; let mut a = vec![]; loop { self.ws(); if self.i >= self.s.len() { break; } if self.s[self.i] == b']' { self.i += 1; break; } if self.s[self.i] == b',' { self.i += 1; continue; } a.push(self.val()); } Json::Arr(a) }
            b'"' => { self.i += 1; let mut out = String::new(); let mut raw: Vec<u8> = vec![]; while self.i < self.s.len() && self.s[self.i] != b'"' { if self.s[self.i] == b'\\' { self.i += 1; let c = self.s[self.i]; match c { b'n' => raw.push(b'\n'), b't' => raw.push(b'\t'), b'r' => raw.push(b'\r'), b'u' => { let h = std::str::from_utf8(&self.s[self.i + 1..self.i + 5]).unwrap_or("0"); let cp = u32::from_str_radix(h, 16).unwrap_or(63); let ch = std::char::from_u32(cp).unwrap_or('?'); let mut b = [0u8; 4]; raw.extend_from_slice(ch.encode_utf8(&mut b).as_bytes()); self.i += 4; } other => raw.push(other) } } else { raw.push(self.s[self.i]); } self.i += 1; } self.i += 1; out.push_str(&String::from_utf8_lossy(&raw)); Json::Str(out) }
            b't' => { self.i += 4; Json::Bool(true) }
            b'f' => { self.i += 5; Json::Bool(false) }
            b'n' => { self.i += 4; Json::Null }
            _ => { let st = self.i; while self.i < self.s.len() && matches!(self.s[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') { self.i += 1; } Json::Num(std::str::from_utf8(&self.s[st..self.i]).unwrap_or("").parse().unwrap_or(f64::NAN)) }
        }
    }
}
#[allow(dead_code)]
pub fn zeff_parse(text: &str) -> Json { ZeffP { s: text.as_bytes(), i: 0 }.val() }
#[allow(dead_code)]
pub fn input(name: &str) -> Json {
    let key: String = name.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
    zeff_parse(&std::fs::read_to_string(format!("_inputs/{}.json", key)).unwrap_or_default())
}
pub fn zeff_quote(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() { match c { '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), '\n' => o.push_str("\\n"), '\r' => o.push_str("\\r"), '\t' => o.push_str("\\t"), c if (c as u32) < 32 => o.push_str(&format!("\\u{:04x}", c as u32)), c => o.push(c) } }
    o.push('"'); o
}
pub trait ZeffToJson { fn zeff_json(&self) -> String; }
macro_rules! zeff_num { ($($t:ty),*) => { $( impl ZeffToJson for $t { fn zeff_json(&self) -> String { let f = *self as f64; if f.is_finite() { format!("{}", self) } else { "null".to_string() } } } )* } }
zeff_num!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize, f32, f64);
impl ZeffToJson for bool { fn zeff_json(&self) -> String { self.to_string() } }
impl ZeffToJson for String { fn zeff_json(&self) -> String { zeff_quote(self) } }
impl ZeffToJson for &str { fn zeff_json(&self) -> String { zeff_quote(self) } }
impl ZeffToJson for () { fn zeff_json(&self) -> String { "null".to_string() } }
impl<T: ZeffToJson> ZeffToJson for Vec<T> { fn zeff_json(&self) -> String { format!("[{}]", self.iter().map(|x| x.zeff_json()).collect::<Vec<_>>().join(",")) } }
impl<T: ZeffToJson> ZeffToJson for Option<T> { fn zeff_json(&self) -> String { match self { Some(x) => x.zeff_json(), None => "null".to_string() } } }
impl<A: ZeffToJson, B: ZeffToJson> ZeffToJson for (A, B) { fn zeff_json(&self) -> String { format!("[{},{}]", self.0.zeff_json(), self.1.zeff_json()) } }
impl<A: ZeffToJson, B: ZeffToJson, C: ZeffToJson> ZeffToJson for (A, B, C) { fn zeff_json(&self) -> String { format!("[{},{},{}]", self.0.zeff_json(), self.1.zeff_json(), self.2.zeff_json()) } }
impl<T: ZeffToJson> ZeffToJson for std::collections::BTreeMap<String, T> { fn zeff_json(&self) -> String { format!("{{{}}}", self.iter().map(|(k, v)| format!("{}:{}", zeff_quote(k), v.zeff_json())).collect::<Vec<_>>().join(",")) } }
impl<T: ZeffToJson> ZeffToJson for std::collections::HashMap<String, T> { fn zeff_json(&self) -> String { format!("{{{}}}", self.iter().map(|(k, v)| format!("{}:{}", zeff_quote(k), v.zeff_json())).collect::<Vec<_>>().join(",")) } }
impl ZeffToJson for Json { fn zeff_json(&self) -> String { match self { Json::Null => "null".to_string(), Json::Bool(b) => b.to_string(), Json::Num(n) => if n.is_finite() { format!("{}", n) } else { "null".to_string() }, Json::Str(s) => zeff_quote(s), Json::Arr(a) => format!("[{}]", a.iter().map(|x| x.zeff_json()).collect::<Vec<_>>().join(",")), Json::Obj(o) => format!("{{{}}}", o.iter().map(|(k, v)| format!("{}:{}", zeff_quote(k), v.zeff_json())).collect::<Vec<_>>().join(",")) } } }
pub struct ZeffW<'a, T>(pub &'a T);
pub trait ZeffViaJson { fn zeff_out(&self) -> String; }
impl<'a, T: ZeffToJson> ZeffViaJson for ZeffW<'a, T> { fn zeff_out(&self) -> String { self.0.zeff_json() } }
pub trait ZeffViaDebug { fn zeff_out(&self) -> String; }
impl<'a, T: std::fmt::Debug> ZeffViaDebug for &ZeffW<'a, T> { fn zeff_out(&self) -> String { zeff_quote(&format!("{:?}", self.0)) } }
fn zeff_hex(s: &str) -> String { s.bytes().map(|b| format!("{:02x}", b)).collect() }
#[allow(dead_code)]
pub fn shared_get(key: &str) -> Option<String> { std::fs::read_to_string(format!("_shared/{}.txt", zeff_hex(key))).ok() }
#[allow(dead_code)]
pub fn shared_set(key: &str, value: &str) { let _ = std::fs::create_dir_all("_shared"); let _ = std::fs::write(format!("_shared/{}.txt", zeff_hex(key)), value); }
#[allow(dead_code)]
pub fn shared_remove(key: &str) { let _ = std::fs::remove_file(format!("_shared/{}.txt", zeff_hex(key))); }
#[allow(dead_code)]
pub fn shared_keys() -> Vec<String> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir("_shared") { for e in rd.flatten() { let n = e.file_name().to_string_lossy().to_string(); if let Some(h) = n.strip_suffix(".txt") { let bytes: Vec<u8> = (0..h.len() / 2).filter_map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).ok()).collect(); out.push(String::from_utf8_lossy(&bytes).to_string()); } } }
    out.sort(); out
}
pub fn zeff_write_return(json: &str) { let _ = std::fs::write("_return.json", json); }
#[allow(unused_macros)]
macro_rules! zeff_return { ($v:expr) => {{ let __v = $v; let __o = (&ZeffW(&__v)).zeff_out(); println!("{}", __o); zeff_write_return(&__o); }} }
`;
